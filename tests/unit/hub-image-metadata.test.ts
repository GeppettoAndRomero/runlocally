import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hubs, validateHubs } from '../../src/i18n/hub';
import { LOCALES } from '../../src/i18n/locales';
import { headData, pagePath } from '../../src/seo/page';

const keys = ['title', 'description', 'h1', 'lead', 'zipCardTitle', 'zipCardDescription', 'imageCardTitle', 'imageCardDescription'];

describe('hub image entry metadata', () => {
  for (const { code } of LOCALES) {
    it(`${code} advertises current conversion and matches built HTML, OG and WebSite data`, () => {
      const content = hubs[code];
      expect(Object.keys(content).sort()).toEqual([...keys].sort());
      expect(content.imageCardTitle).toBe(code === 'ja' ? '画像変換' : 'Image conversion');
      expect(content.imageCardDescription).toBe(code === 'ja'
        ? 'WebP・HEIC などの画像を端末内で JPG／PNG に変換します。入力形式の対応はブラウザに依存します。'
        : 'Convert images such as WebP and HEIC to JPG or PNG on your device. Input support depends on your browser.');
      expect(Object.values(content).join(' ')).not.toMatch(/準備中|予定|coming soon|we plan/i);
      for (const field of ['title', 'description', 'h1', 'lead'] as const) {
        expect(content[field]).toMatch(/ZIP/);
        expect(content[field]).toMatch(code === 'ja' ? /画像/ : /image/);
      }
      expect(Array.from(content.title).length).toBeLessThanOrEqual(60);
      expect(Array.from(content.description).length).toBeLessThanOrEqual(120);
      const html = readFileSync(`dist${pagePath(code, 'hub')}index.html`, 'utf8');
      expect(html).toContain(`<title>${content.title}</title>`);
      expect(html).toContain(`name="description" content="${content.description}"`);
      for (const field of ['title', 'description'] as const) {
        expect(html).toContain(`property="og:${field}" content="${content[field]}"`);
      }
      expect(html).toMatch(new RegExp(`<h1[^>]*>${content.h1}</h1>`));
      expect(html).toContain(content.lead);
      const cards = [...html.matchAll(/<article class="hub-card"[^>]*>([\s\S]*?)<\/article>/g)].map(match => match[1]);
      expect(cards).toHaveLength(2);
      expect(cards[0]).toContain(`href="${pagePath(code, 'top')}"`);
      expect(cards[0]).toContain(content.zipCardTitle);
      expect(cards[0]).toContain(content.zipCardDescription);
      expect(cards[1]).toContain(`href="${pagePath(code, 'image')}"`);
      expect(cards[1]).toContain(content.imageCardTitle);
      expect(cards[1]).toContain(content.imageCardDescription);
      const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
      expect(json).toBeDefined();
      const data = JSON.parse(json ?? 'null');
      expect(data).toEqual(headData(code, 'hub', content).application);
      expect(data['@type']).toBe('WebSite');
      expect(data).not.toHaveProperty('featureList');
    });

    it(`${code} validates dictionary keys, nonblank values and code point boundaries`, () => {
      const dictionary = () => ({ ja: { ...hubs.ja }, en: { ...hubs.en } });
      const boundary = dictionary();
      boundary[code].title = '😀'.repeat(60);
      boundary[code].description = '😀'.repeat(120);
      expect(() => validateHubs(boundary)).not.toThrow();
      for (const field of ['title', 'description'] as const) {
        const invalid = dictionary();
        invalid[code][field] = '😀'.repeat(field === 'title' ? 61 : 121);
        expect(() => validateHubs(invalid)).toThrow(new RegExp(`${field}: .* code points`));
      }
      for (const key of Object.keys(hubs[code])) {
        const missing = dictionary();
        Reflect.deleteProperty(missing[code], key);
        expect(() => validateHubs(missing)).toThrow(/Missing hub content/);
        const blank = dictionary();
        Reflect.set(blank[code], key, '  ');
        expect(() => validateHubs(blank)).toThrow(/Missing hub content/);
      }
      const extra = dictionary();
      Reflect.set(extra[code], 'extra', 'unexpected');
      expect(() => validateHubs(extra)).toThrow(/Missing hub content/);
      const missingLocale = dictionary();
      Reflect.deleteProperty(missingLocale, code);
      expect(() => validateHubs(missingLocale)).toThrow(/Unexpected hub locale/);
    });
  }
});
