import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { AVAILABLE_OPS, OPS, ZIP_SLUGS } from '../../src/i18n/ops';
import type { PageContent } from '../../src/i18n/types';
import {
  alternates, headData, isPublicPageUrl, pagePath, pageUrl,
  publicPageFromPath, publicPageFromUrl, SITE_ORIGIN, zipPageFromPath,
  type PublicPage,
} from '../../src/seo/page';
import { publicPageFromPath as modelPageFromPath } from '../../src/seo/url-model';

const publicRoutes = [
  { locale: 'ja', page: 'hub', path: '/' },
  { locale: 'ja', page: 'top', path: '/zip/' },
  { locale: 'ja', page: 'browse', path: '/zip/view/' },
  { locale: 'ja', page: 'extract', path: '/zip/extract/' },
  { locale: 'ja', page: 'remove', path: '/zip/remove/' },
  { locale: 'ja', page: 'fix-names', path: '/zip/fix-names/' },
  { locale: 'en', page: 'hub', path: '/en/' },
  { locale: 'en', page: 'top', path: '/en/zip/' },
  { locale: 'en', page: 'browse', path: '/en/zip/view/' },
  { locale: 'en', page: 'extract', path: '/en/zip/extract/' },
  { locale: 'en', page: 'remove', path: '/en/zip/remove/' },
  { locale: 'en', page: 'fix-names', path: '/en/zip/fix-names/' },
] as const;
const zipRoutes = publicRoutes.filter(route => route.page !== 'hub');

const oldOperationPaths = [
  '/zip-viewer/', '/unzip/', '/remove-from-zip/', '/zip-filename-fix/',
  '/en/zip-viewer/', '/en/unzip/', '/en/remove-from-zip/', '/en/zip-filename-fix/',
];

const content: PageContent = {
  title: 'ZIP viewer', description: 'Inspect an archive.', h1: 'View ZIP contents',
  lead: 'View entries.', steps: [{ heading: 'Browse entries', body: 'Inspect names.' }],
  faq: [], limits: [],
};

describe('ZIP URL connection', () => {
  it('generates and parses the twelve concrete public URLs through the public module', () => {
    expect(publicRoutes).toHaveLength(12);
    expect(zipRoutes).toHaveLength(10);
    for (const { locale, page, path } of publicRoutes) {
      const route = { locale, page };
      const url = `${SITE_ORIGIN}${path}`;
      expect(pagePath(locale, page)).toBe(path);
      expect(pageUrl(locale, page)).toBe(url);
      expect(publicPageFromPath(path)).toEqual(route);
      expect(zipPageFromPath(path)).toEqual(page === 'hub' ? undefined : route);
      expect(publicPageFromUrl(url)).toEqual(route);
      expect(isPublicPageUrl(url)).toBe(true);
    }
  });

  it('rejects old, unpublished, noncanonical and foreign ZIP routes', () => {
    const unpublished = LOCALES.flatMap(({ code }) => OPS.filter(op => !op.available)
      .map(op => `${code === 'ja' ? '' : `/${code}`}/zip/${ZIP_SLUGS[op.id]}/`));
    const invalidPaths = [
      ...oldOperationPaths, ...unpublished,
      '/ja/zip/', '/fr/zip/', '/zip', '/en/zip', '/zip/view',
      '/zip/view/extra/', '/en/zip/view/extra/', '/zip/view/?file=x',
      '/en/zip/view/#section',
    ];
    for (const path of invalidPaths) {
      expect(publicPageFromPath(path), path).toBeUndefined();
      expect(zipPageFromPath(path), path).toBeUndefined();
      expect(publicPageFromUrl(`${SITE_ORIGIN}${path}`), path).toBeUndefined();
      expect(isPublicPageUrl(`${SITE_ORIGIN}${path}`), path).toBe(false);
    }
    expect(publicPageFromUrl(`https://elsewhere.invalid/zip/`)).toBeUndefined();
    expect(publicPageFromUrl('not a URL')).toBeUndefined();
    expect(() => pagePath('fr' as Locale, 'top')).toThrow(/Unknown locale/);
    for (const op of OPS.filter(entry => !entry.available)) {
      expect(() => pagePath('ja', op.id as PublicPage)).toThrow(/Unavailable page/);
    }
  });

  it('recognizes hubs through the model and public module but not the ZIP parser', () => {
    expect(modelPageFromPath('/')).toEqual({ locale: 'ja', page: 'hub' });
    expect(modelPageFromPath('/en/')).toEqual({ locale: 'en', page: 'hub' });
    expect(publicPageFromPath('/')).toEqual({ locale: 'ja', page: 'hub' });
    expect(publicPageFromPath('/en/')).toEqual({ locale: 'en', page: 'hub' });
    expect(zipPageFromPath('/')).toBeUndefined();
    expect(zipPageFromPath('/en/')).toBeUndefined();
  });

  it('uses one distinct registry slug per operation and publishes four operations', () => {
    expect(OPS).toHaveLength(11);
    expect(Object.keys(ZIP_SLUGS).sort()).toEqual(OPS.map(op => op.id).sort());
    expect(new Set(OPS.map(op => op.slug)).size).toBe(OPS.length);
    for (const op of OPS) expect(op.slug).toBe(ZIP_SLUGS[op.id]);
    expect(AVAILABLE_OPS.map(op => op.id)).toEqual(['browse', 'extract', 'remove', 'fix-names']);
  });

  it('uses ZIP URLs in canonical, OG, JSON-LD and alternates', () => {
    for (const { locale, page, path } of zipRoutes) {
      const url = `${SITE_ORIGIN}${path}`;
      const data = headData(locale, page, content);
      expect(data.canonical).toBe(url);
      expect(data.og.url).toBe(url);
      expect(data.application.url).toBe(url);
      expect(JSON.parse(data.jsonLd).url).toBe(url);
      expect(data.alternates).toEqual(alternates(page));
      expect(data.alternates).toContainEqual({ hreflang: 'x-default', href: `${SITE_ORIGIN}${
        zipRoutes.find(route => route.locale === 'en' && route.page === page)!.path}` });
    }
  });
});
