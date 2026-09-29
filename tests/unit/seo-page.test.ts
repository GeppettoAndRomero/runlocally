import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../astro.config.mjs';
import { DEFAULT_LOCALE, ENGLISH_LOCALE, LOCALES, type Locale } from '../../src/i18n/locales';
import { AVAILABLE_OPS, OPS } from '../../src/i18n/ops';
import type { PageContent } from '../../src/i18n/types';
import {
  alternates, checkMetadataLength, headData, isPublicPageUrl, ogLocale, pagePath, pageUrl,
  publicPageFromUrl, safeJsonLd, SITE_ORIGIN, sitemapI18n,
  type PublicPage,
} from '../../src/seo/page';

const sample: PageContent = {
  title: 'ZIP viewer', description: 'Inspect an archive.', h1: 'View ZIP contents', lead: 'View entries.',
  steps: [{ heading: 'Browse entries', body: 'Inspect names.' }], faq: [], limits: [],
};
const pages: PublicPage[] = ['top', ...AVAILABLE_OPS.map(op => op.id)];

describe('public page metadata', () => {
  it('uses the locale and available operation registries for every URL', () => {
    expect(config.site).toBe(SITE_ORIGIN);
    expect(sitemapI18n).toEqual({
      defaultLocale: DEFAULT_LOCALE,
      locales: Object.fromEntries(LOCALES.map(locale => [locale.code, locale.hreflang])),
    });
    for (const page of pages) {
      for (const locale of LOCALES) {
        const path = pagePath(locale.code, page);
        expect(path.startsWith(locale.code === DEFAULT_LOCALE ? '/' : `/${locale.code}/`)).toBe(true);
        expect(path.endsWith('/')).toBe(true);
        expect(pageUrl(locale.code, page)).toBe(`${SITE_ORIGIN}${path}`);
        expect(publicPageFromUrl(pageUrl(locale.code, page))).toEqual({ locale: locale.code, page });
        expect(alternates(page)).toContainEqual({ hreflang: locale.hreflang, href: pageUrl(locale.code, page) });
      }
      expect(alternates(page)).toContainEqual({ hreflang: 'x-default', href: pageUrl(ENGLISH_LOCALE, page) });
    }
    expect(pagePath(DEFAULT_LOCALE, 'top')).toBe('/');
    expect(pagePath(ENGLISH_LOCALE, 'top')).toBe('/en/');
    for (const op of AVAILABLE_OPS) expect(pagePath(DEFAULT_LOCALE, op.id)).toBe(`/${op.slug}/`);
  });

  it('rejects unavailable operations and URLs with extra data', () => {
    for (const op of OPS.filter(entry => !entry.available)) {
      expect(() => pageUrl(DEFAULT_LOCALE, op.id as PublicPage)).toThrow();
      expect(isPublicPageUrl(`${SITE_ORIGIN}/${op.slug}/`)).toBe(false);
    }
    for (const url of [`${SITE_ORIGIN}/?file=private`, `${SITE_ORIGIN}/#private`, `${SITE_ORIGIN}/browse/`,
      `${SITE_ORIGIN}/en/zip-viewer`, 'https://elsewhere.invalid/']) expect(isPublicPageUrl(url)).toBe(false);
  });

  it('keeps canonical, OG and structured data on the same public URL', () => {
    for (const locale of LOCALES) {
      const data = headData(locale.code, 'browse', sample);
      expect(data.canonical).toBe(pageUrl(locale.code, 'browse'));
      expect(data.og.url).toBe(data.canonical);
      expect(data.og.locale).toBe(ogLocale(locale.code));
      expect(data.og.alternateLocales).toEqual(LOCALES.filter(entry => entry.code !== locale.code).map(entry => ogLocale(entry.code)));
      expect(data.application.url).toBe(data.canonical);
      expect(data.application['@type']).toBe('SoftwareApplication');
      expect(data.application.featureList).toEqual(['Browse entries']);
      expect(data.application).not.toHaveProperty('aggregateRating');
      expect(data.alternates).toEqual(alternates('browse'));
    }
    expect(headData(DEFAULT_LOCALE, 'top', sample).application.featureList).toEqual([]);
  });

  it('uses territory-qualified OG locales and rejects unknown locales', () => {
    expect(ogLocale(DEFAULT_LOCALE)).toBe('ja_JP');
    expect(ogLocale(ENGLISH_LOCALE)).toBe('en_US');
    expect(() => ogLocale('unknown' as Locale)).toThrow(/Unknown OG locale/);
  });

  it('counts Unicode code points and reports blank or over-limit final fields', () => {
    expect(() => checkMetadataLength(DEFAULT_LOCALE, 'top', 'あ'.repeat(60), 'b'.repeat(120))).not.toThrow();
    expect(() => checkMetadataLength(ENGLISH_LOCALE, 'top', '😀'.repeat(60), '説明'.repeat(60))).not.toThrow();
    expect(() => checkMetadataLength(DEFAULT_LOCALE, 'top', '😀'.repeat(61), 'ok')).toThrow(/ja\/top title: 61 code points/);
    expect(() => checkMetadataLength(ENGLISH_LOCALE, 'browse', 'ok', 'x'.repeat(121))).toThrow(/en\/browse description: 121 code points/);
    expect(() => checkMetadataLength(DEFAULT_LOCALE, 'top', '  ', 'ok')).toThrow(/title: 2 code points/);
  });

  it('serializes JSON without ending its script element', () => {
    const content = { ...sample, description: 'Quoted "value"\n</script><script>alert(1)</script>' };
    const data = headData(DEFAULT_LOCALE, 'browse', content);
    expect(data.jsonLd).not.toContain('<');
    expect(JSON.parse(data.jsonLd)).toEqual(data.application);
    expect(safeJsonLd({ value: '\u2028\u2029&<>' })).not.toContain('<');
  });
});

describe('published static files', () => {
  it('points robots at the sitemap index and preserves the security policy', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toBe(`User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap-index.xml\n`);
    expect(readFileSync('public/SECURITY.md', 'utf8')).toBe(readFileSync('SECURITY.md', 'utf8'));
  });

  it('keeps the shared footer colophon equal to the README', () => {
    const base = readFileSync('src/layouts/Base.astro', 'utf8');
    const readme = readFileSync('README.md', 'utf8');
    const colophon = readme.match(/^Colophon: (.+)$/m)?.[1];
    expect(colophon).toBeTruthy();
    expect(base.split(colophon!)).toHaveLength(2);
    expect(base).toContain('href="/SECURITY.md"');
  });
});
