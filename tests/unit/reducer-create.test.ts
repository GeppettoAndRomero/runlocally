import { describe, expect, it } from 'vitest';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import type { Session, SessionAction } from '../../src/app/state/session';

const file = (size = 0) => {
  const value = new File([], 'item.txt');
  Object.defineProperty(value, 'size', { value: size });
  return value;
};
const start = (state = initialSession(), files = [file()], id = 'create-1') =>
  sessionReducer(state, { type: 'create/start', generation: state.generation, id, files });
const progress = { index: 0, total: 2, name: 'item.txt' };
const notifications: Extract<SessionAction, { type: 'create/progress' | 'create/success' | 'create/failure' }>[] = [
  { type: 'create/progress', generation: 0, id: 'create-1', progress },
  { type: 'create/success', generation: 0, id: 'create-1', blob: new Blob(['zip']) },
  { type: 'create/failure', generation: 0, id: 'create-1', error: Error('late') },
];

function publicResult(): Session {
  let state = sessionReducer(initialSession(), { type: 'input/accept', file: file(), kind: 'zip' });
  state = sessionReducer(state, { type: 'listing/start', generation: 1, requestId: 'list' });
  state = sessionReducer(state, { type: 'listing/success', generation: 1, requestId: 'list', route: 'zip', entries: [] });
  state = sessionReducer(state, { type: 'job/start', generation: 1, id: 'extract', op: 'extract' });
  return sessionReducer(state, { type: 'job/success', generation: 1, id: 'extract', op: 'extract',
    output: [{ name: 'item.txt', blob: new Blob() }], resultId: 'result', at: 1 });
}

describe('internal create reducer', () => {
  it('starts without a source and snapshots every file in order', () => {
    const files = [file(), file()];
    const originals = [...files];
    const state = start(initialSession(), files);
    files.reverse(); files.pop();
    expect(state.source).toBeNull();
    expect(state.create.input).toHaveLength(2);
    expect(state.create.input[0]).toBe(originals[0]);
    expect(state.create.input[1]).toBe(originals[1]);
    expect(state.create.run.status).toBe('running');
    const updated = sessionReducer(state, notifications[0]);
    expect(updated.create.run).toMatchObject({ progress });
    expect(updated.create.run.status).toBe('running');
    const done = sessionReducer(updated, notifications[1]);
    expect(done.create.result).toEqual({ sourceFiles: state.create.input, blob: expect.any(Blob),
      name: 'created.zip', count: 2 });
    expect(done.create.run.status).toBe('succeeded');
    for (const action of notifications) expect(sessionReducer(done, action)).toBe(done);
  });
  it('retains input and latest success on failure and rejection without changing public state', () => {
    const base = publicResult();
    const chained = sessionReducer(base, { type: 'result/reinput', resultId: 'result', file: file(), kind: 'zip' });
    const state = sessionReducer(chained, { type: 'input/reject', error: Error('public error') });
    const running = start(state);
    const done = sessionReducer(running, { type: 'create/success', generation: state.generation, id: 'create-1', blob: new Blob() });
    const next = start(done, [file()], 'create-2');
    const failed = sessionReducer(next, { type: 'create/failure', generation: state.generation, id: 'create-2', error: Error('failed') });
    expect(failed.create.run).toMatchObject({ status: 'failed', failure: { message: 'failed' } });
    expect(failed.create.input).toBe(next.create.input);
    expect(failed.create.result).toBe(done.create.result);
    const rejected = sessionReducer(failed, { type: 'create/reject', error: Error('rejected') });
    expect(rejected.create.input).toBe(failed.create.input);
    expect(rejected.create.result).toBe(done.create.result);
    for (const key of ['source', 'job', 'results', 'log', 'inputFailure', 'listing', 'entries', 'selection'] as const) {
      expect(rejected[key]).toBe(state[key]);
    }
    expect(rejected.source?.chain).toEqual(['result']);
  });
  it('validates total sizes and empty input without allocating large data', () => {
    expect(start(initialSession(), [file(600_000_000), file(400_000_000)]).create.run.status).toBe('running');
    expect(start(initialSession(), [file(600_000_000), file(400_000_001)]).create.run)
      .toMatchObject({ status: 'failed', failure: { code: 'too-large' } });
    expect(start(initialSession(), []).create.run).toMatchObject({ status: 'failed', failure: { code: 'unsupported' } });
    expect(start().create.run.status).toBe('running');
  });
  it('enforces exclusion with listing and public jobs in both directions', () => {
    const ready = publicResult();
    for (const busy of [
      sessionReducer(ready, { type: 'listing/start', generation: 1, requestId: 'again' }),
      sessionReducer(ready, { type: 'job/start', generation: 1, id: 'job', op: 'extract' }),
    ]) expect(start(busy)).toBe(busy);
    const creating = start(ready);
    expect(start(creating)).toBe(creating);
    expect(sessionReducer(creating, { type: 'create/reject', error: Error('busy') })).toBe(creating);
    expect(sessionReducer(creating, { type: 'listing/start', generation: 1, requestId: 'again' })).toBe(creating);
    expect(sessionReducer(creating, { type: 'job/start', generation: 1, id: 'job', op: 'extract' })).toBe(creating);
    const empty = initialSession();
    expect(sessionReducer(empty, { type: 'job/start', generation: 0, id: 'job', op: 'extract' })).toBe(empty);
  });
  it('ignores wrong generations, IDs and notifications after reset or input replacement', () => {
    const running = start();
    expect(sessionReducer(initialSession(1), { type: 'create/start', generation: 0, id: 'old', files: [file()] }).create.run.status).toBe('idle');
    for (const action of notifications) {
      expect(sessionReducer(running, { ...action, generation: 1 })).toBe(running);
      expect(sessionReducer(running, { ...action, id: 'other' })).toBe(running);
    }
    const base = publicResult();
    const replacements = [
      sessionReducer(running, { type: 'reset' }),
      sessionReducer(running, { type: 'input/accept', file: file(), kind: 'zip' }),
      sessionReducer(start(base), { type: 'result/reinput', resultId: 'result', file: file(), kind: 'zip' }),
    ];
    for (const state of replacements) {
      expect(state.create).toEqual(initialSession().create);
      for (const action of notifications) expect(sessionReducer(state, action)).toBe(state);
    }
    const replaced = replacements[2];
    expect(sessionReducer(replaced, { type: 'create/success', generation: 1, id: 'create-1', blob: new Blob() })).toBe(replaced);
  });
});
