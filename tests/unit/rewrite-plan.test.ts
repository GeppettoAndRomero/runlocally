import { expect, it } from 'vitest';
import { derivedZipName, repairPlan, repairedName } from '../../src/app/rewrite-plan';
import type { ZipEntry } from '../../src/engine/types';
const entry = (name: string, more: Partial<ZipEntry> = {}): ZipEntry => ({ name, directory: false, size: 1, compressedSize: 1, encrypted: false, utf8: true, ...more });
it('counts changed entries, preserves UTF-8 and missing bytes, and detects new collisions', () => {
  const old = entry('ƒƒ‚’ .txt', { utf8: false, rawFilename: new Uint8Array([0x83,0x81,0x83,0x82,0x92,0xa0,0x2e,0x74,0x78,0x74]) });
  const changed = repairedName(old);
  expect(changed).not.toBe(old.name);
  expect(repairPlan([old, old]).changes).toHaveLength(2);
  expect(repairPlan([old, entry(changed)]).collision).toBe(changed);
  expect(repairPlan([old, entry(old.name, { utf8: true })]).collision).toBeUndefined();
  expect(repairedName(entry(old.name, { utf8: false }))).toBe(old.name);
  expect(repairedName(entry(old.name))).toBe(old.name);
});
it('derives one suffix from a case-insensitive ZIP extension', () => {
  expect(derivedZipName('sample.ZIP', 'trimmed')).toBe('sample-trimmed.zip');
  expect(derivedZipName('sample.zip', 'fixed')).toBe('sample-fixed.zip');
});
