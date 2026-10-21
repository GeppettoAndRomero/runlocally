import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCALES } from '../../src/i18n/locales';
import { hubContent } from '../../src/i18n/hub';
import {
  __createUrlModel, PUBLIC_PAGES, UNLISTED_PAGES, SITE_PAGES,
  pagePath, sitePageFromPath, isIndexable,
} from '../../src/seo/url-model';
import { alternates, headData, isPublicPageUrl, pageUrl } from '../../src/seo/page';
import { publicPagePaths, sitePagePaths, transformPrecache } from '../../scripts/pwa-manifest.mjs';

const model = __createUrlModel(['image']);
const imagePaths = ['/image/', '/en/image/'];
const temps: string[] = [];
const vendor = ['vendor/libarchive/libarchive.wasm', 'vendor/libarchive/worker-bundle.js', 'vendor/libheif/libheif.wasm'];
const assets = ['manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png',
  'SECURITY.md', '_astro/worker-abc.js', ...vendor];
const html = [...sitePagePaths(model)].map(url => ({
  url: url === '/' ? 'index.html' : `${url.slice(1)}index.html`, revision: url,
}));
const entries = [...html, ...assets.map(url => ({ url, revision: url }))];

async function temp(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('site page registry', () => {
  it('registers sixteen site URLs with the same fourteen public URLs', () => {
    expect(UNLISTED_PAGES).toEqual(['image']);
    expect(SITE_PAGES).toEqual([...PUBLIC_PAGES, 'image']);
    expect(sitePagePaths()).toEqual(publicPagePaths());
    expect(sitePagePaths().size).toBe(16);
    for (const { code } of LOCALES) for (const page of PUBLIC_PAGES) {
      expect(isIndexable(page)).toBe(true);
      expect(sitePageFromPath(pagePath(code, page))).toEqual({ locale: code, page });
      expect(headData(code, 'hub', hubContent(code)).robots).toBeUndefined();
    }
    for (const path of imagePaths) expect(sitePageFromPath(path)?.page).toBe('image');
    expect(() => __createUrlModel([]).pagePath('ja', 'image')).toThrow('Unavailable page: image');
    expect(() => __createUrlModel([]).pagePath('en', 'image')).toThrow('Unavailable page: image');
  });

  it('generates and parses registered image pages without exposing public or ZIP routes', () => {
    for (const { code } of LOCALES) {
      const path = code === 'ja' ? '/image/' : '/en/image/';
      expect(model.pagePath(code, 'image')).toBe(path);
      expect(model.sitePageFromPath(path)).toEqual({ locale: code, page: 'image' });
      expect(model.publicPageFromPath(path)).toBeUndefined();
      expect(model.zipPageFromPath(path)).toBeUndefined();
    }
    expect(model.isIndexable('image')).toBe(false);
    for (const path of ['/image', '/en/image', '/ja/image/', '/fr/image/', '/IMAGE/',
      '/image//', '/image/?x=1', '/image/#part', '/%69mage/', '/image/extra/']) {
      expect(model.sitePageFromPath(path), path).toBeUndefined();
    }
    // Exercise runtime input validation without weakening the public types.
    expect(() => Reflect.apply(model.pagePath, undefined, ['fr', 'image'])).toThrow('Unknown locale: fr');
    expect(() => Reflect.apply(model.pagePath, undefined, ['ja', 'unknown'])).toThrow('Unavailable page: unknown');
  });

  it('uses noindex, canonical URLs and complete alternates for the supplied registry', () => {
    const expectedAlternates = [
      { hreflang: 'ja', href: 'https://runlocally.app/image/' },
      { hreflang: 'en', href: 'https://runlocally.app/en/image/' },
      { hreflang: 'x-default', href: 'https://runlocally.app/en/image/' },
    ];
    expect(alternates('image', model)).toEqual(expectedAlternates);
    for (const { code } of LOCALES) {
      const data = headData(code, 'image', hubContent(code), model);
      expect(data.robots).toBe('noindex');
      expect(data.canonical).toBe(`https://runlocally.app${model.pagePath(code, 'image')}`);
      expect(data.canonical).toBe(pageUrl(code, 'image', model));
      expect(data.alternates).toEqual(expectedAlternates);
    }
    expect(() => headData('ja', 'image', hubContent('ja'), __createUrlModel([]))).toThrow('Unavailable page: image');
  });

  it('excludes image URLs through the configured sitemap filter', async () => {
    const config = await readFile(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    expect(config).toMatch(/filter:\s*isPublicPageUrl/);
    const urls = [...sitePagePaths(model)].map(path => `https://runlocally.app${path}`);
    expect(urls.filter(isPublicPageUrl)).toHaveLength(14);
    for (const path of imagePaths) expect(isPublicPageUrl(`https://runlocally.app${path}`)).toBe(false);
  });
});

describe('site precache', () => {
  it('requires both image URLs and preserves their revisions', async () => {
    const root = await temp('site-precache-');
    await mkdir(join(root, 'vendor/libarchive'), { recursive: true });
    await mkdir(join(root, 'vendor/libheif'), { recursive: true });
    for (const path of vendor) await writeFile(join(root, path), path);
    expect(sitePagePaths(model).size).toBe(16);
    for (const path of imagePaths) expect(sitePagePaths(model).has(path)).toBe(true);
    const result = await transformPrecache(entries, root, model);
    for (const path of imagePaths) expect(result.manifest).toContainEqual({ url: path, revision: path });
    for (const path of imagePaths) {
      await expect(transformPrecache(entries.filter(entry => entry.revision !== path), root, model))
        .rejects.toThrow('Missing public HTML');
    }
    await expect(transformPrecache([...entries, { url: 'image/index.html', revision: 'duplicate' }], root, model))
      .rejects.toThrow('Unexpected or duplicate HTML');
    await expect(transformPrecache([...entries, { url: 'unknown/index.html', revision: 'unknown' }], root, model))
      .rejects.toThrow('Unexpected or duplicate HTML');
    await expect(transformPrecache(entries, root, __createUrlModel([]))).rejects.toThrow('Unexpected or duplicate HTML');
  });
});

describe('reserved legacy prefixes', () => {
  it.each(['zip', 'image'])('rejects %s without changing generated output', async prefix => {
    const dir = await temp('site-legacy-');
    for (const folder of ['scripts', 'functions', 'legacy']) await mkdir(join(dir, folder));
    const script = join(dir, 'scripts/gen-legacy.mjs');
    const middleware = join(dir, 'functions/_middleware.js');
    await writeFile(script, await readFile(new URL('../../scripts/gen-legacy.mjs', import.meta.url)));
    const before = await readFile(new URL('../../functions/_middleware.js', import.meta.url));
    await writeFile(middleware, before);
    await writeFile(join(dir, 'legacy/slugs.json'), JSON.stringify(['first-tool', prefix]));
    for (const args of [[], ['--check']]) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Invalid or duplicate legacy slug');
      expect(await readFile(middleware)).toEqual(before);
    }
  });
});
