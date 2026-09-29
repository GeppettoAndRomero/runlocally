import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateNotice } from '../../scripts/gen-notice.mjs';

const roots: string[] = [];
function put(root: string, path: string, content: string) {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pwa-notice-'));
  roots.push(root);
  put(root, 'package.json', JSON.stringify({ devDependencies: { '@vite-pwa/astro': '1.2.0' } }));
  for (const name of ['workbox-core', 'vite-plugin-pwa', 'libarchive.js', 'comlink']) {
    put(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', license: 'MIT' }));
    put(root, `node_modules/${name}/LICENSE`, `License for ${name}`);
  }
  put(root, 'vendor/libarchive-lean/components.json', JSON.stringify({ components: [] }));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('PWA notice attribution', () => {
  it('includes mapped Workbox and explicit plugin with license text', async () => {
    const root = fixture();
    const notice = await generateNotice(root, ['node_modules/workbox-core/index.js']);
    expect(notice).toContain('### workbox-core@1.0.0');
    expect(notice).toContain('### vite-plugin-pwa@1.0.0');
    rmSync(join(root, 'node_modules/vite-plugin-pwa/LICENSE'));
    await expect(generateNotice(root, ['node_modules/workbox-core/index.js'])).rejects.toThrow('Missing license text');
  });
  it('rejects a PWA analysis without mapped Workbox code', async () => {
    await expect(generateNotice(fixture(), ['node_modules/libarchive.js/index.js'])).rejects.toThrow('Workbox code missing');
  });
});
