import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchController } from '../../src/app/workbench-controller';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import type { SessionAction } from '../../src/app/state/session';
import type { CreateOptions } from '../../src/engine/zip/create';

const mock = vi.hoisted(() => ({ factory: vi.fn(), create: vi.fn(), list: vi.fn(), open: vi.fn(), terminate: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: mock.factory, openArchive: mock.open }));
vi.mock('../../src/engine/sniff', () => ({ sniffArchiveKind: () => { throw Error('Unexpected inspection'); } }));

function harness() {
  let state = initialSession();
  const actions: SessionAction[] = [];
  const processing = vi.fn();
  const controller = new WorkbenchController(action => {
    actions.push(action); state = sessionReducer(state, action);
  }, processing);
  return { controller, actions, processing, get state() { return state; } };
}
function deferred() {
  let resolve!: (value: Blob) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Blob>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = (size = 0) => {
  const value = new File([], 'item.txt');
  Object.defineProperty(value, 'size', { value: size });
  return value;
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.factory.mockImplementation(() => ({ createZip: mock.create, listEntries: mock.list, terminate: mock.terminate }));
  mock.create.mockResolvedValue(new Blob(['zip']));
});

describe('internal create controller', () => {
  it('passes all file references and relative paths directly with only progress options', async () => {
    const h = harness();
    const files = [file(), file()];
    const originals = [...files];
    Object.defineProperty(files[1], 'webkitRelativePath', { value: 'folder/item.txt' });
    const pending = deferred();
    mock.create.mockImplementation((_files: File[], options: CreateOptions) => {
      options.onProgress?.({ index: 1, total: 2, name: 'item.txt' });
      return pending.promise;
    });
    const run = h.controller.createFrom(files, h.state);
    files.reverse(); files.pop();
    const [passed, options] = mock.create.mock.calls[0];
    expect(passed).not.toBe(files);
    expect(passed).toEqual(originals);
    expect(passed[0]).toBe(originals[0]);
    expect(passed[1]).toBe(originals[1]);
    expect(passed[1].webkitRelativePath).toBe('folder/item.txt');
    expect(Object.keys(options)).toEqual(['onProgress']);
    expect(h.state.create.run).toMatchObject({ status: 'running', progress: { index: 1 } });
    const blob = new Blob(['result']);
    pending.resolve(blob); await run;
    expect(h.state.create.run.status).toBe('succeeded');
    expect(h.state.create.result).toEqual({ sourceFiles: originals, blob, name: 'created.zip', count: 2 });
    expect(h.state.source).toBeNull();
    expect(h.state.results).toEqual([]);
    expect(mock.list).not.toHaveBeenCalled();
    expect(mock.open).not.toHaveBeenCalled();
    expect(mock.terminate).toHaveBeenCalledTimes(1);
    h.controller.reset();
    expect(mock.terminate).toHaveBeenCalledTimes(1);
    expect(h.controller.processing).toBe(false);
    expect(h.processing.mock.calls).toEqual([[true], [false]]);
  });
  it.each([{ files: [] }, { files: [file(600_000_000), file(400_000_001)] }])('rejects invalid input before worker creation', async ({ files }) => {
    const h = harness();
    await h.controller.createFrom(files, h.state);
    expect(mock.factory).not.toHaveBeenCalled();
    expect(h.state.create.run).toMatchObject({ status: 'failed', failure: { code: files.length ? 'too-large' : 'unsupported' } });
    expect(h.state.inputFailure).toBeUndefined();
    expect(h.controller.processing).toBe(false);
  });
  it('allows the total size boundary', async () => {
    const h = harness();
    await h.controller.createFrom([file(600_000_000), file(400_000_000)], h.state);
    expect(h.state.create.run.status).toBe('succeeded');
  });
  it('rejects concurrent create and existing entry points without replacing the running state', async () => {
    const h = harness();
    const pending = deferred(); mock.create.mockReturnValue(pending.promise);
    const run = h.controller.createFrom([file()], h.state);
    const state = h.state;
    // These sessions would start work if the controller were idle, so the busy guard is what stops them.
    const source = { file: file(), kind: 'zip' as const, chain: [] };
    const ready = { ...initialSession(), op: 'extract' as const, source,
      listing: { status: 'ready' as const, route: 'zip' as const, requestId: 'ready' } };
    const failed = { ...initialSession(), source,
      listing: { status: 'error' as const, route: 'zip' as const, requestId: 'failed',
        failure: { kind: 'engine' as const, code: 'unsupported' as const, message: 'Cannot list' } } };
    await h.controller.createFrom([file()], initialSession());
    await h.controller.accept([file()], h.state);
    await h.controller.run(ready);
    await h.controller.retryListing(failed);
    expect(h.state.create).toBe(state.create);
    expect(mock.factory).toHaveBeenCalledTimes(1);
    expect(mock.list).not.toHaveBeenCalled();
    pending.resolve(new Blob()); await run;
    expect(h.state.create.run.status).toBe('succeeded');
  });
  it.each(['async', 'call', 'factory'])('settles %s errors and releases owned clients', async mode => {
    const h = harness();
    const error = Error('Cannot create');
    if (mode === 'factory') mock.factory.mockImplementation(() => { throw error; });
    else if (mode === 'call') mock.create.mockImplementation(() => { throw error; });
    else mock.create.mockRejectedValue(error);
    await h.controller.createFrom([file()], h.state);
    expect(h.state.create.run).toMatchObject({ status: 'failed', failure: { message: error.message } });
    expect(h.state.create.input).toHaveLength(1);
    expect(h.controller.processing).toBe(false);
    expect(mock.terminate).toHaveBeenCalledTimes(mode === 'factory' ? 0 : 1);
    h.controller.dispose();
    expect(mock.terminate).toHaveBeenCalledTimes(mode === 'factory' ? 0 : 1);
  });
  it.each(['reset', 'dispose'] as const)('suppresses late progress and success after %s', async method => {
    const h = harness();
    const pending = deferred(); mock.create.mockReturnValue(pending.promise);
    const run = h.controller.createFrom([file()], h.state);
    const options: CreateOptions = mock.create.mock.calls[0][1];
    h.controller[method]();
    const count = h.actions.length;
    options.onProgress?.({ index: 0, total: 1, name: 'late' });
    pending.resolve(new Blob()); await run;
    expect(h.actions).toHaveLength(count);
    expect(mock.terminate).toHaveBeenCalledTimes(1);
    expect(h.controller.processing).toBe(false);
    if (method === 'dispose') {
      await h.controller.createFrom([file()], h.state);
      expect(mock.factory).toHaveBeenCalledTimes(1);
    } else expect(h.state.create.run.status).toBe('idle');
  });
  it('keeps the new request busy when an old request rejects after reset', async () => {
    const h = harness();
    const old = deferred(); const next = deferred();
    mock.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = h.controller.createFrom([file()], h.state);
    h.controller.reset();
    const second = h.controller.createFrom([file()], h.state);
    const state = h.state;
    old.reject(Error('terminated')); await first;
    expect(h.state).toBe(state);
    expect(h.controller.processing).toBe(true);
    await h.controller.createFrom([file()], h.state);
    expect(mock.factory).toHaveBeenCalledTimes(2);
    next.resolve(new Blob()); await second;
    expect(h.controller.processing).toBe(false);
    expect(h.state.create.run.status).toBe('succeeded');
    expect(mock.terminate).toHaveBeenCalledTimes(2);
  });
});
