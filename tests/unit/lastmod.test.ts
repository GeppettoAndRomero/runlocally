import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtHashes, checkRegistry, contentHash, sitemapLastmod, updateRegistry, validateRegistry } from '../../scripts/lastmod.mjs';
import { sitemapOptions } from '../../astro.config.mjs';
import { pageUrl } from '../../src/seo/page';
import { PUBLIC_PAGES } from '../../src/seo/url-model';
import { LOCALES } from '../../src/i18n/locales';

const ja = pageUrl('ja', 'hub');
const en = pageUrl('en', 'hub');
const about = pageUrl('ja', 'about');
const day = new Date('2026-01-02T23:30:00Z');
const later = new Date('2026-02-03T00:30:00Z');
const html = (text = '本文', shared = '共通本文', noise = 'aaaaaaaa') => `<!doctype html><html lang="ja"><head>
  <title>ページ</title><meta name="description" content="説明"><meta name="build" content="${noise}">
  <meta name="generated-at" content="${noise}"><link rel="stylesheet" href="/_astro/base.${noise}.css">
  <script type="application/ld+json">{"name":"ページ","@type":"WebPage"}</script></head><body>
  <main><h1>見出し</h1><astro-island props='${noise}'><p>${text}</p></astro-island>
  <a href="/zip/">ZIP</a><img src="/_astro/demo.${noise}.png" alt="説明"></main>
  <footer>${shared}</footer><script>const build = '${noise}'</script></body></html>`;
const hashes = (text = '本文', shared = '共通本文', noise = 'aaaaaaaa') => ({
  [ja]: contentHash(html(text, shared, noise)), [en]: contentHash(html('English', shared, noise)),
  [about]: contentHash(html('About', shared, noise)),
});

describe('content-based lastmod', () => {
  it('keeps dates across identical rebuilds, SHA, time, assets and unused dictionary props', () => {
    const first = updateRegistry({}, hashes(), day, true);
    const rebuilt = hashes('本文', '共通本文', 'bbbbbbbb');
    expect(rebuilt).toEqual(hashes());
    expect(updateRegistry(first, rebuilt, later)).toEqual(first);
    expect(contentHash(html().replace('props=', 'class="new-layout" props='))).toBe(hashes()[ja]);
  });

  it('changes only the affected language and page, preserving unrelated URLs', () => {
    const first = updateRegistry({}, hashes(), day, true);
    const next = updateRegistry(first, hashes('新しい本文'), later);
    expect(next[ja].lastmod).toBe('2026-02-03');
    expect(next[en]).toEqual(first[en]);
    expect(next[about]).toEqual(first[about]);
    expect(() => checkRegistry(first, hashes('新しい本文'))).toThrow('lastmod hashes differ');
    expect(() => checkRegistry(next, hashes('新しい本文'))).not.toThrow();
  });

  it('updates all pages actually rendering changed shared content', () => {
    const next = updateRegistry(updateRegistry({}, hashes(), day, true), hashes('本文', '共通本文の更新'), later);
    expect(Object.values(next).map(entry => entry.lastmod)).toEqual(Array(3).fill('2026-02-03'));
  });

  it.each([
    ['heading', '<h1>見出し</h1>', '<h1>新見出し</h1>'],
    ['link', 'href="/zip/"', 'href="/about/"'],
    ['SEO', 'content="説明"', 'content="新説明"'],
    ['JSON-LD', '"name":"ページ"', '"name":"新ページ"'],
  ])('includes meaningful %s changes', (_label, from, to) => {
    expect(contentHash(html().replace(from, to))).not.toBe(contentHash(html()));
  });

  it('omits unknown dates without guessing, including a first observation after lost history', () => {
    const observed = updateRegistry({}, hashes(), day);
    expect(sitemapLastmod({}, ja)).toBeUndefined();
    expect(sitemapLastmod(observed, ja)).toBeUndefined();
    expect(updateRegistry(observed, hashes(), later)).toEqual(observed);
    expect(() => checkRegistry({}, hashes())).toThrow();
    expect(() => updateRegistry(observed, hashes(), later, true)).toThrow('already initialized');
    expect(() => validateRegistry({ [ja]: { hash: hashes()[ja], lastmod: '2026-02-30' } })).toThrow();
  });

  it('validates the committed sixteen entries against real built HTML and sitemap serialization', async () => {
    const registry = JSON.parse(readFileSync('src/seo/lastmod.json', 'utf8'));
    const built = await builtHashes();
    const urls = LOCALES.flatMap(({ code }) => PUBLIC_PAGES.map(page => pageUrl(code, page)));
    expect(Object.keys(built).sort()).toEqual(urls.sort());
    expect(() => checkRegistry(registry, built)).not.toThrow();
    for (const url of urls) {
      expect(sitemapOptions.serialize({ url, lastmod: '1900-01-01' }).lastmod).toBe(registry[url].lastmod ?? undefined);
    }
  });
});

describe('content hash covers structured data in the body', () => {
  it('changes when a JSON-LD block in the body changes', async () => {
    const { contentHash } = await import('../../scripts/lastmod.mjs');
    const page = (name: string) => `<!doctype html><html lang="en"><head><title>T</title></head><body><main><h1>H</h1></main><script type="application/ld+json">{"@type":"Thing","name":"${name}"}</script></body></html>`;
    expect(contentHash(page('a'))).not.toBe(contentHash(page('b')));
  });
});
