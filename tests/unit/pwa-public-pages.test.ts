import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicPagePaths, transformPrecache } from '../../scripts/pwa-manifest.mjs';
import { addBuildMetaToOutput } from '../../scripts/build-meta.mjs';
import { LOCALES } from '../../src/i18n/locales';
import { PUBLIC_PAGES, pagePath } from '../../src/seo/url-model';

const publicUrls = [
  '/', '/zip/', '/zip/view/', '/zip/extract/', '/zip/remove/', '/zip/fix-names/',
  '/en/', '/en/zip/', '/en/zip/view/', '/en/zip/extract/', '/en/zip/remove/', '/en/zip/fix-names/',
];
const hubs = ['/', '/en/'];
const vendor = ['vendor/libarchive/libarchive.wasm', 'vendor/libarchive/worker-bundle.js'];
const assets = ['manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png',
  'SECURITY.md', '_astro/worker-test.js'];
type Entry = { url: string; revision: string };

function htmlPath(url: string) {
  return `${url.slice(1)}index.html`;
}

function entries(): Entry[] {
  return [
    ...publicUrls.map(url => ({ url: htmlPath(url), revision: url })),
    ...assets.map(url => ({ url, revision: url })),
    ...vendor.map(url => ({ url, revision: url })),
  ];
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pwa-public-pages-'));
  for (const url of publicUrls) {
    const file = join(root, htmlPath(url));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '<html><head></head><body></body></html>');
  }
  for (const path of vendor) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, path);
  }
  return root;
}

describe('public page contract', () => {
  it('has exactly the twelve published URLs without duplicates', () => {
    const modeled = LOCALES.flatMap(locale => PUBLIC_PAGES.map(page => pagePath(locale.code, page)));
    expect(modeled).toEqual(publicUrls);
    expect(new Set(modeled).size).toBe(publicUrls.length);
    expect(publicPagePaths()).toEqual(new Set(modeled));
  });

  it('accepts both hubs and inserts one shared build SHA into every HTML', async () => {
    const root = fixture();
    const sha = 'a'.repeat(40);
    try {
      const result = await transformPrecache(entries(), root);
      expect(result.manifest.filter((entry: Entry) => publicUrls.includes(entry.url)))
        .toHaveLength(publicUrls.length);
      for (const hub of hubs) expect(result.manifest.some((entry: Entry) => entry.url === hub)).toBe(true);
      await addBuildMetaToOutput(pathToFileURL(`${root}/`), sha);
      for (const url of publicUrls) {
        const html = readFileSync(join(root, htmlPath(url)), 'utf8');
        expect(html.match(/<meta name="build" content="[^"]*">/g))
          .toEqual([`<meta name="build" content="${sha}">`]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(hubs)('rejects a missing hub at %s in both outputs', async hub => {
    const root = fixture();
    try {
      await expect(transformPrecache(entries().filter(entry => entry.url !== htmlPath(hub)), root))
        .rejects.toThrow(`Missing public HTML: ${hub}`);
      rmSync(join(root, htmlPath(hub)));
      await expect(addBuildMetaToOutput(pathToFileURL(`${root}/`), 'dev'))
        .rejects.toThrow(`Missing public HTML: ${hub}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate hub and unexpected HTML in the precache', async () => {
    const root = fixture();
    try {
      const all = entries();
      await expect(transformPrecache([...all, { url: htmlPath('/en/'), revision: 'again' }], root))
        .rejects.toThrow('Unexpected or duplicate HTML');
      await expect(transformPrecache([...all, { url: 'other/index.html', revision: 'other' }], root))
        .rejects.toThrow('Unexpected or duplicate HTML');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unexpected HTML before writing build meta', async () => {
    const root = fixture();
    try {
      mkdirSync(join(root, 'other'));
      writeFileSync(join(root, 'other/index.html'), '<html><head></head><body></body></html>');
      await expect(addBuildMetaToOutput(pathToFileURL(`${root}/`), 'dev'))
        .rejects.toThrow('Unexpected or duplicate HTML');
      expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toContain('name="build"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
