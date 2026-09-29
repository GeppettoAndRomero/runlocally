import type { OpId, SessionFailure } from './state/session';
import type { UiStrings } from '../i18n/types';

export function failureText(failure: SessionFailure, t: UiStrings['workbench'], stage: 'input' | 'listing' | 'job', op?: OpId): string {
  if (failure.kind === 'engine') return `${t[failure.code]}${failure.code === 'encrypted-entry' && op === 'remove' ? ` ${t.removeEncrypted}` : ''}${failure.code === 'encrypted-entry' && op === 'fix-names' ? ` ${t.repairEncrypted}` : ''}`;
  if (failure.kind === 'abort') return t.aborted;
  if (failure.message === 'single-file') return t.single;
  if (failure.message === 'busy') return t.busy;
  const genericKey = { input: 'genericInput', listing: 'genericListing', job: 'genericJob' } as const;
  return t[genericKey[stage]];
}
