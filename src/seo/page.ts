import { DEFAULT_LOCALE, ENGLISH_LOCALE, LOCALES, type Locale } from '../i18n/locales';
import { pages as jaPages } from '../i18n/ja/pages';
import { pages as enPages } from '../i18n/en/pages';
import { ui as jaUi } from '../i18n/ja/ui';
import { ui as enUi } from '../i18n/en/ui';
import type { PageContent } from '../i18n/types';
import type { ImagePageContent } from '../i18n/image-page';
import type { AboutContent } from '../i18n/about';
import type { HubContent } from '../i18n/hub';
import { pagePath as modelPagePath, publicPageFromPath, zipPageFromPath, isIndexable, type PublicPage, type SitePage, type UrlModel } from './url-model';

export const SITE_ORIGIN = 'https://runlocally.app';
// Kept equal to package.json `repository` by tests/unit/jsonld-breadcrumb.test.ts. Not imported from
// package.json so that modules shared with the Playwright specs stay free of JSON imports.
export const SOURCE_REPOSITORY = 'https://github.com/GeppettoAndRomero/runlocally';
export const SITE_NAME = 'runlocally';
export type { PublicPage, SitePage } from './url-model';
export { publicPageFromPath, zipPageFromPath };

export function ogLocale(locale: Locale): string {
  const value = LOCALES.find(entry => entry.code === locale)?.ogLocale;
  if (!value) throw new Error(`Unknown OG locale: ${locale}`);
  return value;
}

// An optional model lets internal registry tests exercise the same head and URL generation.
export function pagePath(locale: Locale, page: SitePage, model?: UrlModel): string {
  return (model?.pagePath ?? modelPagePath)(locale, page);
}

export function pageUrl(locale: Locale, page: SitePage, model?: UrlModel): string {
  return new URL(pagePath(locale, page, model), SITE_ORIGIN).href;
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

export function alternates(page: SitePage, model?: UrlModel) {
  return [
    ...LOCALES.map(locale => ({ hreflang: locale.hreflang, href: pageUrl(locale.code, page, model) })),
    { hreflang: 'x-default', href: pageUrl(ENGLISH_LOCALE, page, model) },
  ];
}

export function checkMetadataLength(locale: Locale, page: SitePage, title: string, description: string): void {
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

const breadcrumbNames: Record<Locale, { home: string; zip: string }> = {
  ja: { home: jaUi.chrome.home, zip: jaPages.top.h1 },
  en: { home: enUi.chrome.home, zip: enPages.top.h1 },
};

const freeApplication = {
  offers: { '@type': 'Offer', price: 0, priceCurrency: 'JPY' },
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Web browser',
} as const;

export function headData(locale: Locale, page: SitePage, content: PageContent | HubContent | ImagePageContent | AboutContent, model?: UrlModel) {
  const title = content.title;
  const description = content.description;
  checkMetadataLength(locale, page, title, description);
  const url = pageUrl(locale, page, model);
  const localeInfo = LOCALES.find(entry => entry.code === locale)!;
  const common = { '@context': 'https://schema.org', name: content.h1, description, url, inLanguage: localeInfo.hreflang };
  let application: typeof common & { '@type': 'WebPage'; featureList?: never; alternateName?: never } |
    typeof common & { '@type': 'WebSite'; alternateName: string; sameAs: string[]; featureList?: never } |
    typeof common & typeof freeApplication & { '@type': 'SoftwareApplication'; featureList: string[]; alternateName?: never };
  if (page === 'hub') {
    if ('steps' in content) throw new Error('Hub requires hub content');
    // The WebSite node names the site itself; the heading describes what it offers.
    application = { ...common, '@type': 'WebSite', name: SITE_NAME, alternateName: content.h1, sameAs: [SOURCE_REPOSITORY] };
  } else if (page === 'about') {
    application = { ...common, '@type': 'WebPage' };
  } else if (page === 'image') {
    application = { ...common, ...freeApplication, '@type': 'SoftwareApplication', featureList: ['JPG', 'PNG'] };
  } else {
    if (!('steps' in content) || !Array.isArray(content.steps)) throw new Error('ZIP page requires steps');
    application = { ...common, ...freeApplication, '@type': 'SoftwareApplication',
      featureList: page === 'top' ? [] : content.steps.map(step => step.heading).filter(Boolean) };
  }
  // Keep the site, page/application and navigation as separate schema entities.
  // Both Base.astro and displayPage() serialize this same structure.
  const { '@context': context, ...node } = application;
  const hierarchy: SitePage[] = page === 'hub' ? [] : page === 'top' || page === 'about' || page === 'image'
    ? ['hub', page] : ['hub', 'top', page];
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: hierarchy.map((entry, index) => ({
      '@type': 'ListItem', position: index + 1,
      name: entry === 'hub' ? breadcrumbNames[locale].home : entry === page ? content.h1 : breadcrumbNames[locale].zip,
      item: pageUrl(locale, entry, model),
    })),
  };
  const structuredData = page === 'hub' ? application : { '@context': context, '@graph': [node, breadcrumb] };
  return {
    title,
    description,
    canonical: url,
    alternates: alternates(page, model),
    ...((model?.isIndexable ?? isIndexable)(page) ? {} : { robots: 'noindex' }),
    og: {
      type: 'website',
      url,
      title,
      description,
      siteName: SITE_NAME,
      locale: ogLocale(locale),
      alternateLocales: LOCALES.filter(entry => entry.code !== locale).map(entry => ogLocale(entry.code)),
    },
    application,
    structuredData,
    jsonLd: safeJsonLd(structuredData),
  };
}
