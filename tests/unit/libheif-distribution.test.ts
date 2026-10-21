import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareVendors, vendorPaths } from '../../scripts/vendor-distribution.mjs';
import { sitePagePaths, transformPrecache } from '../../scripts/pwa-manifest.mjs';

const asset = 'vendor/libheif/libheif.wasm';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function files(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? files(root, path) : [path];
  });
}
describe('libheif distribution', () => {
  it('serves precisely the pinned bytes in normal and analysis builds with one matching precache entry', () => {
    const original = readFileSync('node_modules/libheif-js/libheif-wasm/libheif.wasm');
    expect(digest(original)).toBe('184d3d20f8323877f13e9f5254f9c6a0ce272c9a3a2f823b0b2bcd2ee9f73f80');
    for (const root of ['dist', '.notice-build']) {
      expect(readFileSync(join(root, asset))).toEqual(original);
      const duplicates = files(root).filter(path => !path.endsWith('.map') && readFileSync(join(root, path)).equals(original));
      expect(duplicates).toEqual([asset]);
      expect(files(root).some(path => /heic-worker.*\.js$/.test(path))).toBe(true);
      expect(files(root).filter(path => /^vendor\/libheif\/.*\.js$/.test(path))).toEqual([]);
      const entries = [...readFileSync(join(root, 'sw.js'), 'utf8').matchAll(/\{url:"vendor\/libheif\/libheif.wasm",revision:"([a-f0-9]+)",integrity:"sha256-([^"]+)"\}/g)];
      expect(entries).toHaveLength(1);
      expect(entries[0][2]).toBe(createHash('sha256').update(original).digest('base64'));
      expect(readFileSync(join(root, 'NOTICE.md'))).toEqual(readFileSync('NOTICE.md'));
      expect(readFileSync(join(root, 'LICENSE'))).toEqual(readFileSync('LICENSE'));
    }
  });
  it('prepares both vendors from verified sources without publishing glue', () => {
    const root = mkdtempSync(join(tmpdir(), 'vendor-distribution-'));
    try {
      cpSync('vendor', join(root, 'vendor'), { recursive: true });
      for (const name of ['libarchive.js', 'libheif-js']) cpSync(join('node_modules', name), join(root, 'node_modules', name), { recursive: true });
      // A clean checkout has the package files but not the five replaced libarchive files.
      const installed = ['libarchive.wasm', 'libarchive.js', 'libarchive-node.mjs', 'worker-bundle.js', 'worker-bundle-node.mjs'];
      for (const name of installed) writeFileSync(join(root, 'node_modules/libarchive.js/dist', name), 'stock package file');
      prepareVendors(root);
      for (const name of installed) {
        expect(readFileSync(join(root, 'node_modules/libarchive.js/dist', name)), name).toEqual(readFileSync(join('vendor/libarchive-lean', name)));
      }
      expect(files(join(root, 'public')).sort()).toEqual([...vendorPaths].sort());
      for (const path of vendorPaths) expect(readFileSync(join(root, 'public', path))).toEqual(readFileSync(join('public', path)));
      writeFileSync(join(root, 'node_modules/libheif-js/libheif-wasm/libheif.wasm'), 'damaged');
      rmSync(join(root, 'public'), { recursive: true });
      expect(() => prepareVendors(root)).toThrow('SHA-256 mismatch');
      expect(readdirSync(root)).not.toContain('public');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects missing, duplicate and unreadable WASM and isolates revision groups', async () => {
    const root = mkdtempSync(join(tmpdir(), 'libheif-manifest-'));
    const entries = [
      ...[...sitePagePaths()].map(url => ({ url: `${url.slice(1)}index.html` })),
      ...['manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png', 'SECURITY.md', '_astro/worker-test.js', ...vendorPaths].map(url => ({ url })),
    ];
    try {
      for (const path of vendorPaths) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), path);
      }
      const first = (await transformPrecache(entries, root)).manifest;
      writeFileSync(join(root, asset), 'replacement bytes');
      const next = (await transformPrecache(entries, root)).manifest;
      for (const path of vendorPaths) {
        const before = first.find((entry: { url: string; revision?: string; integrity?: string }) => entry.url === path);
        const after = next.find((entry: { url: string; revision?: string; integrity?: string }) => entry.url === path);
        if (path === asset) {
          expect(after?.revision).not.toBe(before?.revision);
          expect(after?.integrity).not.toBe(before?.integrity);
        } else expect(after).toEqual(before);
      }
      await expect(transformPrecache(entries.filter(entry => entry.url !== asset), root)).rejects.toThrow('vendor asset');
      await expect(transformPrecache([...entries, { url: asset }], root)).rejects.toThrow('vendor asset');
      rmSync(join(root, asset));
      await expect(transformPrecache(entries, root)).rejects.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
