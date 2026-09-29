import { DEFAULT_LOCALE, ENGLISH_LOCALE, LOCALES, type Locale } from '../i18n/locales';
import { AVAILABLE_OPS, type AvailableOpId } from '../i18n/ops';
import type { PageContent } from '../i18n/types';

export const SITE_ORIGIN = 'https://runlocally.app';
export type PublicPage = 'top' | AvailableOpId;

const OG_LOCALES: Record<Locale, string> = {
  ja: 'ja_JP',
  en: 'en_US',
};

export function ogLocale(locale: Locale): string {
  const value = OG_LOCALES[locale];
  if (!value) throw new Error(`Unknown OG locale: ${locale}`);
  return value;
}

const opById = new Map<string, string>(AVAILABLE_OPS.map(op => [op.id, op.slug]));
const opBySlug = new Map<string, AvailableOpId>(AVAILABLE_OPS.map(op => [op.slug, op.id]));

export function pagePath(locale: Locale, page: PublicPage): string {
  if (!LOCALES.some(entry => entry.code === locale)) throw new Error(`Unknown locale: ${locale}`);
  if (page !== 'top' && !opById.has(page)) throw new Error(`Unavailable page: ${page}`);
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  return page === 'top' ? `${prefix}/` : `${prefix}/${opById.get(page)}/`;
}

export function pageUrl(locale: Locale, page: PublicPage): string {
  return new URL(pagePath(locale, page), SITE_ORIGIN).href;
}

export function publicPageFromUrl(value: string): { locale: Locale; page: PublicPage } | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.origin !== SITE_ORIGIN || url.search || url.hash) return undefined;
  for (const locale of LOCALES) {
    if (url.pathname === pagePath(locale.code, 'top')) return { locale: locale.code, page: 'top' };
    const prefix = locale.code === DEFAULT_LOCALE ? '/' : `/${locale.code}/`;
    if (!url.pathname.startsWith(prefix)) continue;
    const slug = url.pathname.slice(prefix.length, -1);
    const page = opBySlug.get(slug);
    if (page && url.pathname === pagePath(locale.code, page)) return { locale: locale.code, page };
  }
  return undefined;
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

export function headData(locale: Locale, page: PublicPage, content: PageContent) {
  const title = content.title;
  const description = content.description;
  checkMetadataLength(locale, page, title, description);
  const url = pageUrl(locale, page);
  const localeInfo = LOCALES.find(entry => entry.code === locale)!;
  const application = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: content.h1,
    description,
    url,
    inLanguage: localeInfo.hreflang,
    featureList: page === 'top' ? [] : content.steps.map(step => step.heading).filter(Boolean),
  };
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
