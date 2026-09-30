import { describe, expect, it } from 'vitest';
import { sitemapOptions } from '../../astro.config.mjs';
import { SITE_ORIGIN } from '../../src/seo/page';

const pairs = [
  ['/', '/en/'],
  ['/zip/', '/en/zip/'],
  ['/zip/view/', '/en/zip/view/'],
  ['/zip/extract/', '/en/zip/extract/'],
  ['/zip/remove/', '/en/zip/remove/'],
  ['/zip/fix-names/', '/en/zip/fix-names/'],
] as const;
const url = (path: string) => `${SITE_ORIGIN}${path}`;
const expected = pairs.flatMap(([ja, en]) => [url(ja), url(en)]);

describe('sitemap product options', () => {
  it('accepts exactly the twelve published routes', () => {
    expect(expected).toHaveLength(12);
    expect(new Set(expected).size).toBe(12);
    for (const page of expected) expect(sitemapOptions.filter(page)).toBe(true);
    for (const path of [
      '/zip-viewer/', '/unzip/', '/remove-from-zip/', '/zip-filename-fix/',
      '/en/zip-viewer/', '/en/unzip/', '/en/remove-from-zip/', '/en/zip-filename-fix/',
      '/zip-viewer/ja/', '/unzip/ja/', '/remove-from-zip/ja/', '/zip-filename-fix/ja/',
      '/zip/recover/', '/en/zip/recover/', '/zip/split/', '/en/zip/merge/',
      '/unknown/', '/zip/view', '/en/zip/remove',
    ]) expect(sitemapOptions.filter(url(path))).toBe(false);
    for (const value of [
      'https://elsewhere.invalid/zip/', `${url('/zip/')}?file=x`, `${url('/zip/')}#top`,
    ]) expect(sitemapOptions.filter(value)).toBe(false);
  });

  it('serializes each language to its own complete alternate group', () => {
    for (const [ja, en] of pairs) {
      const links = [
        { lang: 'ja', url: url(ja) },
        { lang: 'en', url: url(en) },
        { lang: 'x-default', url: url(en) },
      ];
      for (const path of [ja, en]) {
        const item = { url: url(path), priority: 0.7, lastmod: '2026-01-01' };
        const result = sitemapOptions.serialize(item);
        expect(result).toEqual({ ...item, links });
        expect(result.links).toHaveLength(3);
        expect(new Set(result.links.map((link: { lang: string }) => link.lang)).size).toBe(3);
        expect(result.links).toContainEqual({ lang: path === ja ? 'ja' : 'en', url: url(path) });
      }
    }
  });

  it('throws for any unrecognized serialized item', () => {
    for (const value of [url('/zip-viewer/'), url('/zip/view'), 'https://elsewhere.invalid/']) {
      expect(() => sitemapOptions.serialize({ url: value })).toThrow(/Unexpected sitemap URL/);
    }
  });
});
