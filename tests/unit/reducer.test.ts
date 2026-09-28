import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/engine/errors';
import { initialSession, inputSizeFailure, sessionReducer } from '../../src/app/state/reducer';
import type { Session, SessionAction } from '../../src/app/state/session';

const file = (name = 'source.zip') => new File(['data'], name);
const entry = { name: 'a.txt', directory: false, size: 1, compressedSize: 1, encrypted: false, utf8: true };
const apply = (state: Session, ...actions: SessionAction[]) => actions.reduce(sessionReducer, state);

function ready(): Session {
  return apply(initialSession(), { type: 'input/accept', file: file(), kind: 'zip' },
    { type: 'listing/start', generation: 1, requestId: 'list-1' },
    { type: 'listing/success', generation: 1, requestId: 'list-1', entries: [entry] });
}

describe('session reducer', () => {
  it('accepts input, lists, selects and rejects stale listing results', () => {
    const start = initialSession();
    const state = ready();
    expect(start.source).toBeNull();
    expect(state.listing.status).toBe('ready');
    expect(state.selection.has('a.txt')).toBe(true);
    const changed = sessionReducer(state, { type: 'selection/toggle', name: 'a.txt', keep: false });
    expect(changed.selection.has('a.txt')).toBe(false);
    expect(state.selection.has('a.txt')).toBe(true);
    const replacement = sessionReducer(state, { type: 'input/accept', file: file('next.zip'), kind: 'zip' });
    expect(replacement.entries).toEqual([]);
    expect(sessionReducer(replacement, { type: 'listing/success', generation: 1, requestId: 'list-1', entries: [entry] })).toBe(replacement);
    expect(sessionReducer(replacement, { type: 'listing/failure', generation: 1, requestId: 'list-1', error: Error('late') })).toBe(replacement);
    const unknown = sessionReducer(state, { type: 'input/accept', file: file('other'), kind: 'rar' });
    expect(sessionReducer(unknown, { type: 'listing/start', generation: 2, requestId: 'rar-list' })).toBe(unknown);
    expect(sessionReducer(unknown, { type: 'job/start', generation: 2, id: 'rar-job', op: 'extract' })).toBe(unknown);
  });
  it('keeps job snapshots and ignores late progress and duplicate success', () => {
    const state = apply(ready(), { type: 'op/input', op: 'extract', input: { mode: 'one', name: 'a.txt' } },
      { type: 'job/start', generation: 1, id: 'job-1', op: 'extract' });
    const edited = sessionReducer(state, { type: 'op/input', op: 'extract', input: { mode: 'all' } });
    expect(edited.job.status === 'running' && edited.job.input).toEqual({ mode: 'one', name: 'a.txt' });
    const progressed = sessionReducer(edited, { type: 'job/progress', generation: 1, id: 'job-1', progress: { kind: 'extract', done: 1, total: 1 } });
    expect(progressed.job.status === 'running' && progressed.job.progress).toEqual({ kind: 'extract', done: 1, total: 1 });
    const action: Extract<SessionAction, { type: 'job/success'; op: 'extract' }> = {
      type: 'job/success', generation: 1, id: 'job-1', op: 'extract', resultId: 'result-1', at: 10,
      output: [{ name: 'a.txt', blob: new Blob(['x']) }] };
    const done = sessionReducer(progressed, action);
    expect(done.results[0].actual).toEqual({ kind: 'extract', files: 1 });
    expect(sessionReducer(done, action)).toBe(done);
    expect(sessionReducer(done, { type: 'job/progress', generation: 1, id: 'job-1', progress: { kind: 'extract', done: 2, total: 2 } })).toBe(done);
  });
  it('records rewrite actuals, retains state on failure, and chains only explicitly', () => {
    const base = ready();
    const running = sessionReducer(base, { type: 'job/start', generation: 1, id: 'remove-1', op: 'remove' });
    const rewrite = { blob: new Blob(['zip']), total: 3, kept: 2, removed: 1, renamed: 0, encryptedCount: 0 };
    const done = sessionReducer(running, { type: 'job/success', generation: 1, id: 'remove-1', op: 'remove',
      output: { name: 'trimmed.zip', rewrite }, resultId: 'r1', at: 20 });
    expect(done.results[0].actual).toEqual({ kind: 'rewrite', counts: { total: 3, kept: 2, removed: 1, renamed: 0, encryptedCount: 0 } });
    expect(done.source).toBe(base.source);
    const failed = apply(done, { type: 'job/start', generation: 1, id: 'remove-2', op: 'remove' },
      { type: 'job/failure', generation: 1, id: 'remove-2', error: new EngineError('bad-central') });
    expect(failed.job.status === 'failed' && failed.job.failure.kind).toBe('engine');
    expect(failed.entries).toBe(done.entries);
    expect(failed.results).toBe(done.results);
    expect(failed.log).toBe(done.log);
    const chained = sessionReducer(failed, { type: 'result/reinput', resultId: 'r1', file: file('derived.zip'), kind: 'zip' });
    expect(chained.source?.chain).toEqual(['r1']);
    expect(chained.generation).toBe(2);
    expect(chained.results).toBe(done.results);
    expect(sessionReducer(chained, { type: 'job/failure', generation: 1, id: 'remove-2', error: Error('late') })).toBe(chained);
    expect(sessionReducer(chained, { type: 'reset' }).source).toBeNull();
  });
  it('uses decimal GB at both input routes without allocating it', () => {
    expect(inputSizeFailure(1_000_000_000)).toBeUndefined();
    expect(inputSizeFailure(1_000_000_001)?.kind).toBe('engine');
    expect(inputSizeFailure(1_000_000_001)).toMatchObject({ code: 'too-large' });
    const oversized = file('oversized.zip');
    Object.defineProperty(oversized, 'size', { value: 1_000_000_001 });
    const state = ready();
    const rejected = sessionReducer(state, { type: 'input/accept', file: oversized, kind: 'zip' });
    expect(rejected.generation).toBe(state.generation);
    expect(rejected.source).toBe(state.source);
    expect(rejected.inputFailure).toMatchObject({ code: 'too-large' });
    const extraction = apply(state, { type: 'job/start', generation: 1, id: 'extract-1', op: 'extract' },
      { type: 'job/success', generation: 1, id: 'extract-1', op: 'extract', resultId: 'r1', at: 1,
        output: [{ name: 'a.txt', blob: new Blob(['a']) }] });
    const chained = sessionReducer(extraction, { type: 'result/reinput', resultId: 'r1', file: oversized, kind: 'zip' });
    expect(chained.generation).toBe(extraction.generation);
    expect(chained.inputFailure).toMatchObject({ code: 'too-large' });
  });
});
