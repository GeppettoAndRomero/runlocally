import { describe, expect, it } from 'vitest';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';

const file = () => new File(['archive'], 'sample.bin');
describe('archive session', () => {
  it.each(['rar', '7z', 'tar'] as const)('lists and extracts %s while preserving distinct metadata', kind => {
    const source = sessionReducer(initialSession(), { type: 'input/accept', file: file(), kind });
    const reading = sessionReducer(source, { type: 'listing/start', generation: 1, requestId: 'list' });
    expect(reading.listing).toMatchObject({ status: 'reading', route: 'archive' });
    expect(sessionReducer(reading, { type: 'listing/success', route: 'archive', generation: 1, requestId: 'old', entries: [] })).toBe(reading);
    const ready = sessionReducer(reading, { type: 'listing/success', route: 'archive', generation: 1, requestId: 'list', entries: [{ path: 'dir/a.txt', size: 2 }] });
    expect(ready.entries).toEqual([]);
    expect(ready.archiveEntries).toEqual([{ path: 'dir/a.txt', size: 2 }]);
    expect(sessionReducer(ready, { type: 'selection/all', keep: false })).toBe(ready);
    expect(sessionReducer(ready, { type: 'job/start', generation: 1, id: 'remove', op: 'remove' })).toBe(ready);
    const running = sessionReducer(ready, { type: 'job/start', generation: 1, id: 'extract', op: 'extract' });
    expect(running.job).toMatchObject({ status: 'running', op: 'extract' });
    const done = sessionReducer(running, { type: 'job/success', generation: 1, id: 'extract', op: 'extract', resultId: 'r1', at: 1, output: [] });
    expect(done.results[0].actual).toEqual({ kind: 'extract', files: 0 });
    const rejected = sessionReducer(done, { type: 'input/reject', error: Error('single-file') });
    expect(rejected.source).toBe(done.source);
    expect(rejected.results).toBe(done.results);
  });
  it('does not start a listing for unknown or accept a mismatched route', () => {
    const unknown = sessionReducer(initialSession(), { type: 'input/accept', file: file(), kind: 'unknown' });
    expect(sessionReducer(unknown, { type: 'listing/start', generation: 1, requestId: 'x' })).toBe(unknown);
    const source = sessionReducer(initialSession(), { type: 'input/accept', file: file(), kind: 'zip' });
    const reading = sessionReducer(source, { type: 'listing/start', generation: 1, requestId: 'x' });
    expect(sessionReducer(reading, { type: 'listing/success', route: 'archive', generation: 1, requestId: 'x', entries: [] })).toBe(reading);
  });
});
