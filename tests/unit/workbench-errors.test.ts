import { expect, it } from 'vitest';
import { failureText } from '../../src/app/workbench-errors';
import { workbenchStrings } from '../../src/app/workbench-strings';
import type { SessionFailure } from '../../src/app/state/session';
const codes = ['wrong-password', 'encrypted-entry', 'bad-central', 'too-large', 'unsupported', 'not-encrypted'] as const;
it.each(['ja', 'en'] as const)('maps every engine code and ordinary failures in %s', locale => {
  const t = workbenchStrings[locale];
  for (const code of codes) {
    const failure: SessionFailure = { kind: 'engine', code, message: 'raw internal text' };
    expect(failureText(failure, t, 'listing')).toBe(t[code]);
    expect(failureText(failure, t, 'listing')).not.toContain('raw internal text');
  }
  expect(failureText({ kind: 'abort', message: 'raw' }, t, 'job')).toBe(t.aborted);
  expect(failureText({ kind: 'other', message: 'raw' }, t, 'input')).toBe(t.genericInput);
  expect(failureText({ kind: 'other', message: 'raw' }, t, 'listing')).toBe(t.genericListing);
  expect(failureText({ kind: 'other', message: 'raw' }, t, 'job')).toBe(t.genericJob);
  const encrypted: SessionFailure = { kind: 'engine', code: 'encrypted-entry', message: 'raw' };
  expect(failureText(encrypted, t, 'job', 'remove')).toContain(t.removeEncrypted);
  expect(failureText(encrypted, t, 'job', 'fix-names')).toContain(t.repairEncrypted);
});
