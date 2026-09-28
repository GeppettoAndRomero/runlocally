import { describe, expect, it } from 'vitest';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import type { Session, SessionAction } from '../../src/app/state/session';

const file = (name: string) => new File(['data'], name);
const entry = (name: string) => ({ name, directory: false, size: 1, compressedSize: 1, encrypted: false, utf8: true });
const apply = (state: Session, ...actions: SessionAction[]) => actions.reduce(sessionReducer, state);

function ready(): Session {
  return apply(initialSession(),
    { type: 'input/accept', file: file('source.zip'), kind: 'zip' },
    { type: 'listing/start', generation: 1, requestId: 'list-1' },
    { type: 'listing/success', route: 'zip', generation: 1, requestId: 'list-1', entries: [entry('source.txt')] });
}

const success = (id: string, resultId: string, at: number): SessionAction => ({
  type: 'job/success', generation: 1, id, op: 'extract', resultId, at,
  output: [{ name: `${resultId}.txt`, blob: new Blob([resultId]) }],
});

describe('stale notifications within one input generation', () => {
  it('accepts only the latest listing request', () => {
    const reading = apply(initialSession(),
      { type: 'input/accept', file: file('source.zip'), kind: 'zip' },
      { type: 'listing/start', generation: 1, requestId: 'list-old' },
      { type: 'listing/start', generation: 1, requestId: 'list-new' });

    expect(reading.listing).toMatchObject({ status: 'reading', requestId: 'list-new' });
    expect(sessionReducer(reading, { type: 'listing/success', route: 'zip', generation: 1, requestId: 'list-old', entries: [entry('old.txt')] })).toBe(reading);
    expect(sessionReducer(reading, { type: 'listing/failure', generation: 1, requestId: 'list-old', error: Error('old') })).toBe(reading);

    const readyState = sessionReducer(reading, { type: 'listing/success', route: 'zip', generation: 1, requestId: 'list-new', entries: [entry('new.txt')] });
    expect(readyState.entries.map(({ name }) => name)).toEqual(['new.txt']);
    expect(readyState.listing).toMatchObject({ status: 'ready', requestId: 'list-new' });
  });

  it('ignores the previous job while the next job is running', () => {
    const first = apply(ready(),
      { type: 'job/start', generation: 1, id: 'job-old', op: 'extract' },
      success('job-old', 'result-old', 1),
      { type: 'job/start', generation: 1, id: 'job-new', op: 'extract' });
    expect(first.job).toMatchObject({ status: 'running', id: 'job-new' });
    expect(sessionReducer(first, { type: 'job/progress', generation: 1, id: 'job-old', progress: { kind: 'extract', done: 1, total: 1 } })).toBe(first);
    expect(sessionReducer(first, success('job-old', 'duplicate', 2))).toBe(first);
    expect(sessionReducer(first, { type: 'job/failure', generation: 1, id: 'job-old', error: Error('old') })).toBe(first);

    const completed = sessionReducer(first, success('job-new', 'result-new', 3));
    expect(completed.results.map(({ id }) => id)).toEqual(['result-old', 'result-new']);
    expect(completed.log.map(({ jobId }) => jobId)).toEqual(['job-old', 'job-new']);
  });
});

describe('result provenance', () => {
  it('reinputs each result from its own source chain', () => {
    const first = apply(ready(),
      { type: 'job/start', generation: 1, id: 'job-1', op: 'extract' },
      success('job-1', 'r1', 1));
    const fromR1 = sessionReducer(first, { type: 'result/reinput', resultId: 'r1', file: file('r1.zip'), kind: 'zip' });
    expect(fromR1.source?.chain).toEqual(['r1']);
    const second = apply(fromR1,
      { type: 'listing/start', generation: 2, requestId: 'list-2' },
      { type: 'listing/success', route: 'zip', generation: 2, requestId: 'list-2', entries: [entry('r1.txt')] },
      { type: 'job/start', generation: 2, id: 'job-2', op: 'extract' },
      { type: 'job/success', generation: 2, id: 'job-2', op: 'extract', resultId: 'r2', at: 2,
        output: [{ name: 'r2.txt', blob: new Blob(['r2']) }] });
    expect(second.results[1].sourceChain).toEqual(['r1']);

    const other = sessionReducer(second, { type: 'input/accept', file: file('other.zip'), kind: 'zip' });
    const fromR2 = sessionReducer(other, { type: 'result/reinput', resultId: 'r2', file: file('r2.zip'), kind: 'zip' });
    expect(fromR2.source?.chain).toEqual(['r1', 'r2']);
    const backToR1 = sessionReducer(fromR2, { type: 'result/reinput', resultId: 'r1', file: file('r1-again.zip'), kind: 'zip' });
    expect(backToR1.source?.chain).toEqual(['r1']);
    expect(backToR1.results[0].sourceChain).toEqual([]);
    expect(backToR1.results[1].sourceChain).toEqual(['r1']);
  });
});
