import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { publicPagePaths } from '../../scripts/pwa-manifest.mjs';

function files(path: string): string[] {
  return readdirSync(path).flatMap(name => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}
describe('production PWA output', () => {
  it('contains one root worker and manifest with all public pages and matched vendor assets', () => {
    const paths = files('dist');
    expect(paths.filter(path => path.endsWith('/sw.js'))).toEqual(['dist/sw.js']);
    expect(paths.filter(path => path.endsWith('.webmanifest'))).toEqual(['dist/manifest.webmanifest']);
    expect(paths.some(path => path.endsWith('.map'))).toBe(false);
    const sw = readFileSync('dist/sw.js', 'utf8');
    expect(sw).not.toContain('importScripts(');
    expect(sw).toContain('SKIP_WAITING');
    for (const url of publicPagePaths()) expect(sw).toContain(`url:${JSON.stringify(url)}`);
    expect(sw).not.toContain('zip-viewer/index.html');
    const pair = ['worker-bundle.js', 'libarchive.wasm'].map(name => {
      const match = sw.match(new RegExp(`url:"vendor/libarchive/${name.replace('.', '\\.')}"\\,revision:"([a-f0-9]+)"\\,integrity:"sha256-([^"]+)"`));
      expect(match).not.toBeNull();
      return match!;
    });
    expect(pair[0][1]).toBe(pair[1][1]);
    expect(pair[0][2]).not.toBe(pair[1][2]);
    expect(JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8')).scope).toBe('/');
  });
});
