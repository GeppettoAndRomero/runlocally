import { DEFAULT_LOCALE, ENGLISH_LOCALE, LOCALES, type Locale } from '../i18n/locales';
import type { PageContent } from '../i18n/types';
import type { HubContent } from '../i18n/hub';
import { pagePath as modelPagePath, publicPageFromPath, zipPageFromPath, type PublicPage } from './url-model';

export const SITE_ORIGIN = 'https://runlocally.app';
export type { PublicPage } from './url-model';
export { publicPageFromPath, zipPageFromPath };

export function ogLocale(locale: Locale): string {
  const value = LOCALES.find(entry => entry.code === locale)?.ogLocale;
  if (!value) throw new Error(`Unknown OG locale: ${locale}`);
  return value;
}

export function pagePath(locale: Locale, page: PublicPage): string {
  return modelPagePath(locale, page);
}

export function pageUrl(locale: Locale, page: PublicPage): string {
  return new URL(pagePath(locale, page), SITE_ORIGIN).href;
}

export function publicPageFromUrl(value: string): { locale: Locale; page: PublicPage } | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.origin !== SITE_ORIGIN || url.search || url.hash || value !== url.href) return undefined;
  return publicPageFromPath(url.pathname);
}

export function isPublicPageUrl(value: string): boolean {
  return publicPageFromUrl(value) !== undefined;
}

export const sitemapI18n = {
  defaultLocale: DEFAULT_LOCALE,
  locales: Object.fromEntries(LOCALES.map(locale => [locale.code, locale.hreflang])),
};

export function alternates(page: PublicPage) {
  return [
    ...LOCALES.map(locale => ({ hreflang: locale.hreflang, href: pageUrl(locale.code, page) })),
    { hreflang: 'x-default', href: pageUrl(ENGLISH_LOCALE, page) },
  ];
}

export function checkMetadataLength(locale: Locale, page: PublicPage, title: string, description: string): void {
  for (const [field, value, limit] of [['title', title, 60], ['description', description, 120]] as const) {
    const length = Array.from(value).length;
    if (!value.trim() || length > limit) {
      throw new Error(`${locale}/${page} ${field}: ${length} code points (limit ${limit}; nonblank required)`);
    }
  }
}

export function safeJsonLd(value: object): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function headData(locale: Locale, page: PublicPage, content: PageContent | HubContent) {
  const title = content.title;
  const description = content.description;
  checkMetadataLength(locale, page, title, description);
  const url = pageUrl(locale, page);
  const localeInfo = LOCALES.find(entry => entry.code === locale)!;
  const common = { '@context': 'https://schema.org', name: content.h1, description, url, inLanguage: localeInfo.hreflang };
  let application: typeof common & { '@type': 'WebSite'; featureList?: never } |
    typeof common & { '@type': 'SoftwareApplication'; featureList: string[] };
  if (page === 'hub') {
    if ('steps' in content) throw new Error('Hub requires hub content');
    application = { ...common, '@type': 'WebSite' };
  } else {
    if (!('steps' in content) || !Array.isArray(content.steps)) throw new Error('ZIP page requires steps');
    application = { ...common, '@type': 'SoftwareApplication',
      featureList: page === 'top' ? [] : content.steps.map(step => step.heading).filter(Boolean) };
  }
  return {
    title,
    description,
    canonical: url,
    alternates: alternates(page),
    og: {
      type: 'website',
      url,
      title,
      description,
      siteName: 'runlocally',
      locale: ogLocale(locale),
      alternateLocales: LOCALES.filter(entry => entry.code !== locale).map(entry => ogLocale(entry.code)),
    },
    application,
    jsonLd: safeJsonLd(application),
  };
}
