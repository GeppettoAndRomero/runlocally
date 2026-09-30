import type { Locale } from '../../src/i18n/locales';
import type { AvailableOpId } from '../../src/i18n/ops';
import { pagePath } from '../../src/seo/page';

export function zipHome(locale: Locale): string {
  return pagePath(locale, 'top');
}

export function zipOp(locale: Locale, opId: AvailableOpId): string {
  return pagePath(locale, opId);
}
