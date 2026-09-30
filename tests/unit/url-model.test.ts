import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { AVAILABLE_OPS, OPS, ZIP_SLUGS } from '../../src/i18n/ops';
import {
  pagePath, publicPageFromPath, zipPageFromPath, PUBLIC_PAGES, ZIP_PAGES,
  type PublicPage,
} from '../../src/seo/url-model';
import {
  pagePath as currentPagePath, publicPageFromPath as currentPageFromPath,
  zipPageFromPath as currentZipPageFromPath,
  type PublicPage as CurrentPage,
} from '../../src/seo/page';

const expectedRoutes = [
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

const expectedSlugs = {
  browse: 'view', extract: 'extract', remove: 'remove', 'fix-names': 'fix-names',
  recover: 'recover', split: 'split', merge: 'merge', unlock: 'unlock',
  encrypt: 'encrypt', create: 'create', 'rar-7z': 'rar-7z',
};

const legacyRoutes = [
  { locale: 'ja', page: 'top', path: '/' },
  { locale: 'ja', page: 'browse', path: '/zip-viewer/' },
  { locale: 'ja', page: 'extract', path: '/unzip/' },
  { locale: 'ja', page: 'remove', path: '/remove-from-zip/' },
  { locale: 'ja', page: 'fix-names', path: '/zip-filename-fix/' },
  { locale: 'en', page: 'top', path: '/en/' },
  { locale: 'en', page: 'browse', path: '/en/zip-viewer/' },
  { locale: 'en', page: 'extract', path: '/en/unzip/' },
  { locale: 'en', page: 'remove', path: '/en/remove-from-zip/' },
  { locale: 'en', page: 'fix-names', path: '/en/zip-filename-fix/' },
] as const;

describe('planned URL model', () => {
  it('derives page sets from the available operation registry', () => {
    expect(ZIP_PAGES).toEqual(['top', ...AVAILABLE_OPS.map(op => op.id)]);
    expect(PUBLIC_PAGES).toEqual(['hub', ...ZIP_PAGES]);
    expect(ZIP_PAGES).toHaveLength(5);
    expect(PUBLIC_PAGES).toHaveLength(6);
    expect(new Set(ZIP_PAGES).size).toBe(5);
    expect(new Set(PUBLIC_PAGES).size).toBe(6);
  });

  it('uses the twelve specified URLs independently of the parser', () => {
    for (const { locale, page, path } of expectedRoutes) {
      expect(pagePath(locale, page)).toBe(path);
    }
  });

  it('round trips every public page and limits ZIP detection to ZIP pages', () => {
    const paths = LOCALES.flatMap(({ code }) => PUBLIC_PAGES.map(page => {
      const path = pagePath(code, page);
      expect(publicPageFromPath(path)).toEqual({ locale: code, page });
      expect(zipPageFromPath(path)).toEqual(page === 'hub' ? undefined : { locale: code, page });
      return path;
    }));
    expect(paths).toHaveLength(12);
    expect(new Set(paths).size).toBe(12);
    expect(paths.filter(path => zipPageFromPath(path))).toHaveLength(10);
    expect(paths.filter(path => !zipPageFromPath(path))).toEqual(['/', '/en/']);
  });

  it('has one distinct planned slug for each of the eleven registered operations', () => {
    expect(ZIP_SLUGS).toEqual(expectedSlugs);
    expect(Object.keys(ZIP_SLUGS).sort()).toEqual(OPS.map(op => op.id).sort());
    expect(new Set(Object.values(ZIP_SLUGS)).size).toBe(OPS.length);
    expect(AVAILABLE_OPS.map(op => op.id)).toEqual(['browse', 'extract', 'remove', 'fix-names']);
    expect(OPS.filter(op => !op.available).map(op => op.id)).toEqual([
      'recover', 'split', 'merge', 'unlock', 'encrypt', 'create', 'rar-7z',
    ]);
  });

  it('does not generate or recognize the seven unavailable operations', () => {
    for (const { code } of LOCALES) {
      const prefix = code === 'ja' ? '' : `/${code}`;
      for (const op of OPS.filter(entry => !entry.available)) {
        expect(() => pagePath(code, op.id as PublicPage)).toThrow(/Unavailable page/);
        const path = `${prefix}/zip/${ZIP_SLUGS[op.id]}/`;
        expect(publicPageFromPath(path)).toBeUndefined();
        expect(zipPageFromPath(path)).toBeUndefined();
      }
    }
  });

  it('rejects unknown locale and page values during generation', () => {
    expect(() => pagePath('fr' as Locale, 'top')).toThrow(/Unknown locale/);
    expect(() => pagePath('ja', 'unknown' as PublicPage)).toThrow(/Unavailable page/);
  });

  it('accepts only exact canonical pathnames', () => {
    const invalid = [
      '/ja/', '/ja/zip/', '/zip/en/', '/fr/', '/fr/zip/', '/zip/unknown/',
      '/zip', '/en/zip', '/zip/view', '/en/zip/view',
      '/zip/view/extra/', '/en/zip/view/extra/', '/zip//view/',
      '/zip/view/?file=archive', '/zip/view/#details', '/?q=1', '/en/#start',
      ...legacyRoutes.filter(route => route.page !== 'top').map(route => route.path),
    ];
    for (const path of invalid) {
      expect(publicPageFromPath(path), path).toBeUndefined();
      expect(zipPageFromPath(path), path).toBeUndefined();
    }
  });
});

describe('connected ZIP routes', () => {
  it('uses the ZIP slugs and keeps the publication boundary', () => {
    expect(Object.fromEntries(OPS.map(op => [op.id, op.slug]))).toEqual(expectedSlugs);
    expect(OPS.filter(op => op.available).map(op => op.id)).toEqual([
      'browse', 'extract', 'remove', 'fix-names',
    ]);
  });

  it('uses the twelve public URLs and round trips', () => {
    const pages: CurrentPage[] = ['hub', 'top', ...AVAILABLE_OPS.map(op => op.id)];
    expect(expectedRoutes).toHaveLength(LOCALES.length * pages.length);
    for (const { locale, page, path } of expectedRoutes) {
      expect(currentPagePath(locale, page)).toBe(path);
      expect(currentPageFromPath(path)).toEqual({ locale, page });
      expect(currentZipPageFromPath(path)).toEqual(page === 'hub' ? undefined : { locale, page });
    }
    for (const { code } of LOCALES) for (const page of pages) {
      expect(currentPageFromPath(currentPagePath(code, page))).toEqual({ locale: code, page });
    }
  });

  it('accepts hubs only in the public parser and rejects legacy operations', () => {
    for (const { path } of expectedRoutes.filter(route => route.page === 'hub')) {
      expect(currentPageFromPath(path)).toEqual(publicPageFromPath(path));
      expect(currentZipPageFromPath(path)).toBeUndefined();
    }
    for (const { path } of legacyRoutes.filter(route => route.page !== 'top')) {
      expect(currentPageFromPath(path)).toBeUndefined();
      expect(currentZipPageFromPath(path)).toBeUndefined();
    }
  });
});
