import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubContent, hubs } from '../../src/i18n/hub';
import { LOCALES } from '../../src/i18n/locales';
import { pageContent } from '../../src/i18n/pages';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import type { PageContent } from '../../src/i18n/types';
import {
  alternates, headData, isPublicPageUrl, pagePath, pageUrl, publicPageFromPath,
  publicPageFromUrl, zipPageFromPath, type PublicPage,
} from '../../src/seo/page';
import { PUBLIC_PAGES, type PublicPage as ModelPublicPage } from '../../src/seo/url-model';

const sameType = <T extends ModelPublicPage>(page: PublicPage & T): ModelPublicPage => page;
const expected = [
  '/', '/en/', '/zip/', '/zip/view/', '/zip/extract/', '/zip/remove/', '/zip/fix-names/',
  '/en/zip/', '/en/zip/view/', '/en/zip/extract/', '/en/zip/remove/', '/en/zip/fix-names/',
];

describe('hub routes', () => {
  it('uses the model public type and generates the exact public pathname set', () => {
    expect(sameType('hub')).toBe('hub');
    const actual = LOCALES.flatMap(({ code }) => PUBLIC_PAGES.map(page => pagePath(code, page)));
    expect(actual).toHaveLength(new Set(actual).size);
    expect(actual.sort()).toEqual([...expected].sort());
  });

  it('round trips public URLs while keeping ZIP routes separate', () => {
    for (const { code } of LOCALES) for (const page of PUBLIC_PAGES) {
      const path = pagePath(code, page);
      expect(publicPageFromPath(path)).toEqual({ locale: code, page });
      expect(publicPageFromUrl(pageUrl(code, page))).toEqual({ locale: code, page });
      expect(isPublicPageUrl(pageUrl(code, page))).toBe(true);
      expect(zipPageFromPath(path)).toEqual(page === 'hub' ? undefined : { locale: code, page });
    }
  });

  it('rejects old, unpublished and noncanonical URLs', () => {
    const invalid = ['/view/', '/en/view/', '/zip/create/', '/en/zip/merge/', '/zip',
      '/en', '/ZIP/', '/en//', '/en/zip/../', '/ja/', '/zip/%76iew/'];
    for (const path of invalid) {
      expect(publicPageFromPath(path)).toBeUndefined();
      expect(publicPageFromUrl(`https://runlocally.app${path}`)).toBeUndefined();
    }
    for (const url of ['https://other.invalid/', 'https://runlocally.app/?x=1',
      'https://runlocally.app/en/#part', 'not a URL']) expect(publicPageFromUrl(url)).toBeUndefined();
  });
});

describe('hub content and metadata', () => {
  it('has only both locale dictionaries with complete matching hub keys', () => {
    expect(Object.keys(hubs).sort()).toEqual(LOCALES.map(locale => locale.code).sort());
    const keys = ['title', 'description', 'h1', 'lead', 'zipCardTitle', 'zipCardDescription'];
    for (const { code } of LOCALES) {
      const content = hubContent(code);
      expect(Object.keys(content).sort()).toEqual([...keys].sort());
      for (const value of Object.values(content)) expect(value.trim()).not.toBe('');
      expect(content).not.toHaveProperty('steps');
      expect(content).not.toHaveProperty('faq');
      expect(content).not.toHaveProperty('limits');
      expect(content.zipCardTitle).toBeTruthy();
      expect(content.zipCardDescription).toBeTruthy();
      expect(pagePath(code, 'top')).toBe(code === 'ja' ? '/zip/' : '/en/zip/');
    }
  });

  it('uses canonical, complete alternates, OG and WebSite JSON-LD', () => {
    for (const { code, hreflang, ogLocale } of LOCALES) {
      const content = hubContent(code);
      const data = headData(code, 'hub', content);
      const url = code === 'ja' ? 'https://runlocally.app/' : 'https://runlocally.app/en/';
      expect(data.canonical).toBe(url);
      expect(data.alternates).toEqual([
        { hreflang: 'ja', href: 'https://runlocally.app/' },
        { hreflang: 'en', href: 'https://runlocally.app/en/' },
        { hreflang: 'x-default', href: 'https://runlocally.app/en/' },
      ]);
      expect(data.alternates).toEqual(alternates('hub'));
      expect(data.og).toMatchObject({ type: 'website', url, title: content.title,
        description: content.description, locale: ogLocale });
      expect(data.application).toEqual({ '@context': 'https://schema.org', '@type': 'WebSite',
        name: content.h1, description: content.description, url, inLanguage: hreflang });
      expect(data.application).not.toHaveProperty('featureList');
      expect(JSON.parse(data.jsonLd)).toEqual(data.application);
    }
  });

  it('checks hub metadata lengths through headData using Unicode code points', () => {
    const base = hubContent('en');
    const data = (title: string, description: string) => headData('en', 'hub', { ...base, title, description });
    expect(data('😀'.repeat(60), 'x'.repeat(120)).title).toBe('😀'.repeat(60));
    expect(() => data('😀'.repeat(61), 'ok')).toThrow(/title: 61 code points/);
    expect(() => data('ok', '😀'.repeat(121))).toThrow(/description: 121 code points/);
    expect(() => data('  ', 'ok')).toThrow(/title/);
    expect(() => data('ok', '  ')).toThrow(/description/);
  });

  it('preserves ZIP dictionaries and their SoftwareApplication features', () => {
    for (const { code } of LOCALES) for (const page of PUBLIC_PAGES) {
      if (page === 'hub') continue;
      const content = pageContent(code, page);
      for (const key of ['title', 'description', 'h1', 'lead'] as const) expect(content[key].trim()).not.toBe('');
      for (const key of ['steps', 'faq', 'limits'] as const) expect(content[key].length).toBeGreaterThan(0);
      const data = headData(code, page, content);
      expect(data.application['@type']).toBe('SoftwareApplication');
      expect(data.application.featureList).toEqual(page === 'top' ? [] : content.steps.map(step => step.heading));
      expect(JSON.parse(data.jsonLd)).toEqual(data.application);
    }
    expect(AVAILABLE_OPS).toHaveLength(PUBLIC_PAGES.length - 2);
  });

  it('requires ZIP steps and keeps the hub content boundary', () => {
    expect(() => headData('ja', 'top', hubContent('ja'))).toThrow(/ZIP page requires steps/);
    expect(() => headData('ja', 'hub', pageContent('ja', 'top'))).toThrow(/Hub requires hub content/);
  });
});

afterEach(() => {
  vi.doUnmock('../../src/i18n/ja/pages.ts');
  vi.resetModules();
});

describe('ZIP dictionary validation', () => {
  for (const field of ['title', 'description', 'h1', 'lead', 'steps', 'faq', 'limits'] as const) {
    it(`rejects missing or empty ${field} on module load`, async () => {
      const original = await import('../../src/i18n/ja/pages.ts');
      const top: PageContent = { ...original.pages.top,
        [field]: field === 'steps' || field === 'faq' || field === 'limits' ? [] : '  ' };
      vi.doMock('../../src/i18n/ja/pages.ts', () => ({ pages: { ...original.pages, top } }));
      vi.resetModules();
      await expect(import('../../src/i18n/pages.ts')).rejects.toThrow(/Missing page content: ja\/top/);
    });
  }
});
