import { createZipEngine, openArchive, type ZipEngineClient } from './engine';
import type { OpenArchive } from '../engine/archive/libarchive';
import { sniffArchiveKind, type ArchiveKind } from '../engine/sniff';
import { inputSizeFailure } from './state/reducer';
import type { Session, SessionAction } from './state/session';
import { derivedZipName, repairPlan, repairedName } from './rewrite-plan';

export class WorkbenchController {
  private epoch = 0;
  private serial = 0;
  private busy = false;
  private disposed = false;
  private clients = new Set<ZipEngineClient>();
  private handles = new Set<OpenArchive>();

  constructor(private publish: (action: SessionAction) => void, private onProcessingChange: (processing: boolean) => void = () => {}) {}
  get processing(): boolean { return this.busy; }
  private setBusy(value: boolean): void {
    if (this.busy === value) return;
    this.busy = value;
    this.onProcessingChange(value);
  }
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
    this.setBusy(false);
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
    this.setBusy(true);
    try {
      const bytes = new Uint8Array(await file.slice(0, 263).arrayBuffer());
      if (this.disposed || epoch !== this.epoch) return;
      const kind = sniffArchiveKind(bytes);
      if (resultId && !session.results.some(result => result.id === resultId)) return;
      this.dispatch(resultId ? { type: 'result/reinput', resultId, file, kind } : { type: 'input/accept', file, kind });
      if (kind === 'unknown') return;
      await this.list(file, kind, session.generation + 1, epoch);
    } catch (error) {
      if (epoch === this.epoch && !this.disposed) this.dispatch({ type: 'input/reject', error });
    } finally { if (epoch === this.epoch) this.setBusy(false); }
  }
  async retryListing(state: Session): Promise<void> {
    if (this.disposed || this.busy || !state.source || state.listing.status !== 'error') return;
    const epoch = this.epoch;
    this.setBusy(true);
    try { await this.list(state.source.file, state.source.kind, state.generation, epoch); }
    finally { if (epoch === this.epoch) this.setBusy(false); }
  }
  private async list(file: File, kind: ArchiveKind, generation: number, epoch: number): Promise<void> {
    const requestId = this.id();
    this.dispatch({ type: 'listing/start', generation, requestId });
    try {
      if (kind === 'zip') {
        const client = createZipEngine(); this.clients.add(client);
        try {
          const entries = await client.listEntries(file);
          if (epoch === this.epoch && !this.disposed) this.dispatch({ type: 'listing/success', generation, requestId, route: 'zip', entries });
        } finally { client.terminate(); this.clients.delete(client); }
      } else {
        const handle = await openArchive(file);
        if (epoch !== this.epoch || this.disposed) { handle.close(); return; }
        this.handles.add(handle);
        try { this.dispatch({ type: 'listing/success', generation, requestId, route: 'archive', entries: handle.entries }); }
        finally { this.close(handle); }
      }
    } catch (error) {
      if (epoch === this.epoch && !this.disposed) this.dispatch({ type: 'listing/failure', generation, requestId, error });
    }
  }
  async run(state: Session): Promise<void> {
    if (this.disposed || this.busy || !state.source || state.listing.status !== 'ready' || state.op === 'browse') return;
    const op = state.op;
    if (op !== 'extract') {
      if (state.source.kind !== 'zip' || state.listing.route !== 'zip') return;
      if (op === 'remove' && (!state.entries.some(entry => !state.selection.has(entry.name)) ||
        !state.entries.some(entry => !entry.directory && state.selection.has(entry.name)))) return;
      const plan = repairPlan(state.entries);
      if (op === 'fix-names' && (!plan.changes.length || plan.collision)) return;
    }
    const epoch = this.epoch;
    const generation = state.generation;
    const id = this.id();
    this.dispatch({ type: 'job/start', generation, id, op });
    this.setBusy(true);
    const { file } = state.source;
    const input = { ...state.inputs.extract };
    const kept = new Set(state.selection);
    try {
      let output: { name: string; blob: Blob }[];
      const progress = (done: number, total: number) => {
        if (epoch === this.epoch) this.dispatch({ type: 'job/progress', generation, id, progress: { kind: 'extract', done, total } });
      };
      if (state.source.kind === 'zip') {
        const client = createZipEngine(); this.clients.add(client);
        try {
          if (op === 'extract') output = input.mode === 'one' ? [{ name: input.name, blob: await client.extractEntry(file, input.name) }]
            : await client.extractAll(file, progress);
          else {
            const rewrite = await client.rewriteZip(file, {
              ...(op === 'remove' ? { keep: (name: string) => kept.has(name) } : { rename: (_name: string, entry: typeof state.entries[number]) => repairedName(entry) }),
              onProgress: value => { if (epoch === this.epoch) this.dispatch({ type: 'job/progress', generation, id, progress: { kind: 'rewrite', progress: value } }); },
            });
            if (epoch === this.epoch) this.dispatch({ type: 'job/success', generation, id, op, output: {
              name: derivedZipName(file.name, op === 'remove' ? 'trimmed' : 'fixed'), rewrite,
            }, resultId: this.id(), at: Date.now() });
            return;
          }
        } finally { client.terminate(); this.clients.delete(client); }
      } else {
        if (op !== 'extract') return;
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
    } finally { if (epoch === this.epoch) this.setBusy(false); }
  }
}
