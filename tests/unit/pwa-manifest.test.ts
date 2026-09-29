import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicPagePaths, transformPrecache } from '../../scripts/pwa-manifest.mjs';

type Entry = { url: string; revision?: string; integrity?: string };
const html = [...publicPagePaths()].map(url => ({ url: url === '/' ? 'index.html' : `${url.slice(1)}index.html`, revision: url }));
const vendor = ['vendor/libarchive/libarchive.wasm', 'vendor/libarchive/worker-bundle.js'];
const assets = ['manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png', 'SECURITY.md', '_astro/worker-abc.js'];
const manifestEntries = [...html, ...assets.map(url => ({ url, revision: url })), ...vendor.map(url => ({ url, revision: 'old' }))];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pwa-manifest-'));
  for (const path of vendor) {
    mkdirSync(join(root, 'vendor/libarchive'), { recursive: true });
    writeFileSync(join(root, path), path);
  }
  return root;
}
describe('precache transform', () => {
  it('uses every public URL and keeps each HTML revision', async () => {
    const root = fixture();
    try {
      const result = await transformPrecache(manifestEntries, root);
      expect(result.manifest.filter((entry: Entry) => entry.url.endsWith('/')).map((entry: Entry) => entry.url).sort()).toEqual([...publicPagePaths()].sort());
      for (const entry of html) expect(result.manifest.find((item: Entry) => item.revision === entry.revision)?.url).toBe(entry.revision);
      const pair = result.manifest.filter((entry: Entry) => entry.url.startsWith('vendor/'));
      expect(pair[0].revision).toBe(pair[1].revision);
      expect(pair[0].integrity).not.toBe(pair[1].integrity);
      writeFileSync(join(root, vendor[0]), 'changed');
      const next = await transformPrecache(manifestEntries, root);
      expect(next.manifest.find((entry: Entry) => entry.url === vendor[0])?.revision).not.toBe(pair[0].revision);
      expect(next.manifest.find((entry: Entry) => entry.url === vendor[0])?.revision).toBe(next.manifest.find((entry: Entry) => entry.url === vendor[1])?.revision);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects absent pages, duplicates and an incomplete vendor pair', async () => {
    const root = fixture();
    try {
      const all = manifestEntries;
      await expect(transformPrecache(all.slice(1), root)).rejects.toThrow('Missing public HTML');
      await expect(transformPrecache([...all, html[0]], root)).rejects.toThrow('duplicate HTML');
      await expect(transformPrecache(all.filter((entry: Entry) => entry.url !== vendor[0]), root)).rejects.toThrow('vendor asset');
      await expect(transformPrecache(all.filter((entry: Entry) => entry.url !== 'icons/app-512.png'), root)).rejects.toThrow('precache asset');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
