import { describe, expect, it } from 'vitest';
import { allNames, applyToggle, descendants, directoryState, isEmptyResult,
  keptFileCount, removedFileCount, setAll } from '../../src/app/state/reducer';

const entries = [
  { name: 'a/', directory: true }, { name: 'a/one', directory: false },
  { name: 'a/two', directory: false }, { name: 'ab/', directory: true },
  { name: 'ab/one', directory: false }, { name: 'a/one', directory: false },
];

describe('name based keep selection', () => {
  it('cascades at a directory boundary without mutating the previous set', () => {
    const before = allNames(entries);
    const after = applyToggle(entries, before, 'a/', false);
    expect([...descendants(entries, 'a/')]).toEqual(['a/', 'a/one', 'a/two', 'a/one']);
    expect(after.has('ab/one')).toBe(true);
    expect(after.has('a/one')).toBe(false);
    expect(before.has('a/one')).toBe(true);
    expect(directoryState(entries, 'a/', after)).toBe('unchecked');
    expect(directoryState(entries, 'ab/', after)).toBe('checked');
    const childrenOnly = new Set(['a/one', 'a/two']);
    expect(directoryState(entries, 'a/', childrenOnly)).toBe('checked');
  });
  it('supports mixed, all, none, and file counts across duplicate names', () => {
    const mixed = applyToggle(entries, allNames(entries), 'a/one', false);
    expect(directoryState(entries, 'a/', mixed)).toBe('indeterminate');
    expect(keptFileCount(entries, mixed)).toBe(2);
    expect(removedFileCount(entries, mixed)).toBe(2);
    expect(setAll(entries, false).size).toBe(0);
    expect(isEmptyResult(entries, setAll(entries, false))).toBe(true);
    expect(keptFileCount(entries, setAll(entries, true))).toBe(4);
  });
  it('ignores unknown names and handles empty entries', () => {
    expect(applyToggle(entries, new Set(), 'missing', true).size).toBe(0);
    expect(directoryState(entries, 'missing/', new Set())).toBe('unchecked');
    expect(allNames([]).size).toBe(0);
    expect(isEmptyResult([], new Set())).toBe(true);
  });
});
