import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { imageSoon, imageSoonContent } from '../../src/i18n/image-soon';
import { LOCALES } from '../../src/i18n/locales';
import { headData, isPublicPageUrl } from '../../src/seo/page';
import { SITE_PAGES, PUBLIC_PAGES, pagePath, sitePageFromPath, publicPageFromPath, zipPageFromPath } from '../../src/seo/url-model';

describe('image coming soon', () => {
  it('has complete nonblank dictionaries and bounded metadata', () => {
    expect(Object.keys(imageSoon).sort()).toEqual(LOCALES.map(locale => locale.code).sort());
    for (const { code } of LOCALES) {
      const content = imageSoonContent(code);
      expect(Object.keys(content).sort()).toEqual(['title', 'description', 'h1', 'lead', 'body', 'hubLink', 'zipLink'].sort());
      for (const value of Object.values(content)) expect(value.trim()).not.toBe('');
      expect(Array.from(content.title).length).toBeLessThanOrEqual(60);
      expect(Array.from(content.description).length).toBeLessThanOrEqual(120);
      expect(content.lead).toMatch(code === 'ja' ? /準備中/ : /coming soon/);
      expect(content.body).toMatch(code === 'ja' ? /予定/ : /plan to/);
      const data = (title: string, description: string) => headData(code, 'image', { ...content, title, description });
      expect(data('😀'.repeat(60), '😀'.repeat(120)).title).toBe('😀'.repeat(60));
      expect(() => data('😀'.repeat(61), 'ok')).toThrow(/title: 61 code points/);
      expect(() => data('ok', '😀'.repeat(121))).toThrow(/description: 121 code points/);
      expect(() => data(' ', 'ok')).toThrow(/title/);
      expect(() => data('ok', ' ')).toThrow(/description/);
    }
  });

  it('registers only site routes with noindex WebPage metadata', () => {
    expect(SITE_PAGES).toHaveLength(8);
    expect(PUBLIC_PAGES).toHaveLength(7);
    for (const { code } of LOCALES) {
      const path = code === 'ja' ? '/image/' : '/en/image/';
      expect(pagePath(code, 'image')).toBe(path);
      expect(sitePageFromPath(path)).toEqual({ locale: code, page: 'image' });
      expect(publicPageFromPath(path)).toBeUndefined();
      expect(zipPageFromPath(path)).toBeUndefined();
      expect(isPublicPageUrl(`https://runlocally.app${path}`)).toBe(false);
      const data = headData(code, 'image', imageSoonContent(code));
      expect(data.robots).toBe('noindex');
      expect(data.canonical).toBe(`https://runlocally.app${path}`);
      expect(data.alternates).toEqual([
        { hreflang: 'ja', href: 'https://runlocally.app/image/' },
        { hreflang: 'en', href: 'https://runlocally.app/en/image/' },
        { hreflang: 'x-default', href: 'https://runlocally.app/en/image/' },
      ]);
      expect(data.application['@type']).toBe('WebPage');
      expect(data.application).not.toHaveProperty('featureList');
      expect(JSON.parse(data.jsonLd)).toEqual(data.application);
      const html = readFileSync(`dist${path}index.html`, 'utf8');
      expect(html).toContain('name="robots" content="noindex"');
      expect(html).toContain('component-export="PwaStartup"');
      expect(html).not.toContain('component-export="Workbench"');
      expect(readFileSync('dist/sw.js', 'utf8')).toContain(path);
    }
  });
});
