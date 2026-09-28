import { createZipEngine, openArchive, type ZipEngineClient } from './engine';
import type { OpenArchive } from '../engine/archive/libarchive';
import { sniffArchiveKind } from '../engine/sniff';
import { inputSizeFailure } from './state/reducer';
import type { Session, SessionAction } from './state/session';

export class WorkbenchController {
  private epoch = 0;
  private serial = 0;
  private busy = false;
  private disposed = false;
  private clients = new Set<ZipEngineClient>();
  private handles = new Set<OpenArchive>();

  constructor(private publish: (action: SessionAction) => void) {}
  get processing(): boolean { return this.busy; }
  dispatch(action: SessionAction): void {
    if (this.disposed) return;
    this.publish(action);
  }
  private id(): string { return `${Date.now()}-${++this.serial}`; }
  private close(handle: OpenArchive): void {
    if (this.handles.delete(handle)) handle.close();
  }
  private invalidate(): number {
    this.epoch++;
    for (const client of this.clients) client.terminate();
    this.clients.clear();
    for (const handle of this.handles) handle.close();
    this.handles.clear();
    this.busy = false;
    return this.epoch;
  }
  dispose(): void { this.invalidate(); this.disposed = true; }
  reset(): void { this.invalidate(); this.dispatch({ type: 'reset' }); }
  async accept(files: readonly File[], session: Session, resultId?: string): Promise<void> {
    if (this.disposed) return;
    if (this.busy) { this.dispatch({ type: 'input/reject', error: Error('busy') }); return; }
    if (files.length !== 1) { this.dispatch({ type: 'input/reject', error: Error('single-file') }); return; }
    const file = files[0];
    const sizeFailure = inputSizeFailure(file.size);
    if (sizeFailure) { this.dispatch({ type: 'input/reject', error: sizeFailure }); return; }
    const epoch = this.invalidate();
    this.busy = true;
    let listingRequest: { generation: number; requestId: string } | undefined;
    try {
      const bytes = new Uint8Array(await file.slice(0, 263).arrayBuffer());
      if (this.disposed || epoch !== this.epoch) return;
      const kind = sniffArchiveKind(bytes);
      if (resultId && !session.results.some(result => result.id === resultId)) return;
      this.dispatch(resultId ? { type: 'result/reinput', resultId, file, kind } : { type: 'input/accept', file, kind });
      if (kind === 'unknown') return;
      const generation = session.generation + 1;
      const requestId = this.id();
      listingRequest = { generation, requestId };
      this.dispatch({ type: 'listing/start', generation, requestId });
      if (kind === 'zip') {
        const client = createZipEngine();
        this.clients.add(client);
        try {
          const entries = await client.listEntries(file);
          if (epoch === this.epoch) this.dispatch({ type: 'listing/success', generation, requestId, route: 'zip', entries });
        } finally { client.terminate(); this.clients.delete(client); }
      } else {
        const handle = await openArchive(file);
        if (epoch !== this.epoch || this.disposed) { handle.close(); return; }
        this.handles.add(handle);
        try { this.dispatch({ type: 'listing/success', generation, requestId, route: 'archive', entries: handle.entries }); }
        finally { this.close(handle); }
      }
    } catch (error) {
      if (epoch === this.epoch && !this.disposed) {
        if (listingRequest) this.dispatch({ type: 'listing/failure', ...listingRequest, error });
        else this.dispatch({ type: 'input/reject', error });
      }
    } finally { if (epoch === this.epoch) this.busy = false; }
  }
  async run(state: Session): Promise<void> {
    if (this.disposed || this.busy || !state.source || state.listing.status !== 'ready' || state.op !== 'extract') return;
    const epoch = this.epoch;
    const generation = state.generation;
    const id = this.id();
    this.dispatch({ type: 'job/start', generation, id, op: 'extract' });
    this.busy = true;
    const { file } = state.source;
    const input = { ...state.inputs.extract };
    try {
      let output: { name: string; blob: Blob }[];
      const progress = (done: number, total: number) => {
        if (epoch === this.epoch) this.dispatch({ type: 'job/progress', generation, id, progress: { kind: 'extract', done, total } });
      };
      if (state.source.kind === 'zip') {
        const client = createZipEngine(); this.clients.add(client);
        try {
          output = input.mode === 'one' ? [{ name: input.name, blob: await client.extractEntry(file, input.name) }]
            : await client.extractAll(file, progress);
        } finally { client.terminate(); this.clients.delete(client); }
      } else {
        const handle = await openArchive(file);
        if (epoch !== this.epoch || this.disposed) { handle.close(); return; }
        this.handles.add(handle);
        let closedByApi = false;
        try {
          if (input.mode === 'one') output = [{ name: input.name, blob: await handle.extractOne(input.name) }];
          else {
            const files = await handle.extractAll(progress);
            closedByApi = true;
            output = files.map((blob, index) => ({ name: handle.entries[index].path, blob }));
          }
        } finally {
          if (closedByApi) this.handles.delete(handle);
          else this.close(handle);
        }
      }
      if (epoch === this.epoch) this.dispatch({ type: 'job/success', generation, id, op: 'extract', output, resultId: this.id(), at: Date.now() });
    } catch (error) {
      if (epoch === this.epoch) this.dispatch({ type: 'job/failure', generation, id, error });
    } finally { if (epoch === this.epoch) this.busy = false; }
  }
}
