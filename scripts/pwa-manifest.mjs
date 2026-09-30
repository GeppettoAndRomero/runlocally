import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCALES } from '../src/i18n/locales.ts';
import { PUBLIC_PAGES, pagePath } from '../src/seo/url-model.ts';

const vendorPaths = ['vendor/libarchive/libarchive.wasm', 'vendor/libarchive/worker-bundle.js'];
export const publicPagePaths = () => new Set(LOCALES.flatMap(locale =>
  PUBLIC_PAGES.map(page => pagePath(locale.code, page))));

export async function transformPrecache(entries, root = 'public') {
  const expected = publicPagePaths();
  const seen = new Set();
  const result = entries.map(entry => {
    if (!entry.url.endsWith('.html')) return { ...entry };
    const path = entry.url.replace(/^\//, '');
    const url = path === 'index.html' ? '/' : `/${path.slice(0, -'index.html'.length)}`;
    if (!expected.has(url) || seen.has(url)) throw new Error(`Unexpected or duplicate HTML: ${entry.url}`);
    seen.add(url);
    return { ...entry, url };
  });
  if (seen.size !== expected.size) throw new Error(`Missing public HTML: ${[...expected].filter(path => !seen.has(path)).join(', ')}`);
  const assets = new Set(result.map(entry => entry.url.replace(/^\//, '')));
  for (const asset of ['manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png', 'SECURITY.md']) {
    if (!assets.has(asset)) throw new Error(`Missing precache asset: ${asset}`);
  }
  if (![...assets].some(asset => /^_astro\/worker-[^/]+\.js$/.test(asset))) throw new Error('Missing application worker');
  const vendor = await Promise.all(vendorPaths.map(async path => {
    const matches = result.filter(entry => entry.url.replace(/^\//, '') === path);
    if (matches.length !== 1) throw new Error(`Missing or duplicate vendor asset: ${path}`);
    return { path, entry: matches[0], bytes: await readFile(join(root, path)) };
  }));
  const revisionHash = createHash('sha256');
  for (const { path, bytes } of vendor) {
    revisionHash.update(path).update('\0').update(createHash('sha256').update(bytes).digest('hex')).update('\0');
  }
  const revision = revisionHash.digest('hex');
  for (const { entry, bytes } of vendor) {
    entry.revision = revision;
    entry.integrity = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
  }
  return { manifest: result, warnings: [] };
}
