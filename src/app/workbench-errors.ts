import type { OpId, SessionFailure } from './state/session';

export function failureText(failure: SessionFailure, t: Record<string, string>, stage: 'input' | 'listing' | 'job', op?: OpId): string {
  if (failure.kind === 'engine') return `${t[failure.code]}${failure.code === 'encrypted-entry' && op === 'remove' ? ` ${t.removeEncrypted}` : ''}${failure.code === 'encrypted-entry' && op === 'fix-names' ? ` ${t.repairEncrypted}` : ''}`;
  if (failure.kind === 'abort') return t.aborted;
  if (failure.message === 'single-file') return t.single;
  if (failure.message === 'busy') return t.busy;
  return t[`generic${stage[0].toUpperCase()}${stage.slice(1)}`];
}
