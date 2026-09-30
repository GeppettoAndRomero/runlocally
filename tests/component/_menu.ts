import type { Locale } from '../../src/i18n/locales';
import { AVAILABLE_OPS, type AvailableOpId } from '../../src/i18n/ops';
import { menuUi } from '../../src/i18n/ui';

export function menuName(locale: Locale, opId: AvailableOpId): string {
  const op = AVAILABLE_OPS.find(entry => entry.id === opId);
  if (!op) throw new Error(`Unavailable operation: ${opId}`);
  return menuUi[locale][op.i18nKey].verb;
}
