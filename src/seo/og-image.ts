import { ui as ja } from '../i18n/ja/ui';
import { ui as en } from '../i18n/en/ui';
import type { Locale } from '../i18n/locales';

const homeLabels: Record<Locale, string> = { ja: ja.chrome.home, en: en.chrome.home };

// One brand image for every tool and language; the alt follows the site's home label.
export function socialImage(locale: Locale, origin: string, siteName: string) {
  return {
    image: new URL('/icons/social-card.png', origin).href,
    imageWidth: '1200',
    imageHeight: '630',
    imageAlt: `${siteName} — ${homeLabels[locale]}`,
  };
}
