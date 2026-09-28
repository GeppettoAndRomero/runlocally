import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateNotice, packageLocationsFromSources, checkNotice } from '../../scripts/gen-notice.mjs';

const script = fileURLToPath(new URL('../../scripts/gen-notice.mjs', import.meta.url));
const roots: string[] = [];
function put(root: string, path: string, content: string) {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'notice-browser-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(script, join(root, 'scripts/gen-notice.mjs'));
  for (const name of ['alpha', 'zeta', 'libarchive.js', 'comlink']) {
    put(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', license: 'MIT', author: { email: 'private@example.invalid' } }));
    put(root, `node_modules/${name}/LICENSE`, `Permission for ${name}\n`);
  }
  put(root, 'vendor/libarchive-lean/components.json', JSON.stringify({ components: [
    { name: 'wasm component', version: '1', spdx: 'MIT', source: 'source', copyright: 'holder', linkage: 'static', licenseFile: 'component-LICENSE' },
  ] }));
  put(root, 'vendor/libarchive-lean/licenses/component-LICENSE', 'WASM permission\n');
  put(root, '.notice-build/_astro/client.js.map', JSON.stringify({ sources: [
    '../../node_modules/zeta/index.js', '../../node_modules/alpha/index.js', '../../node_modules/zeta/other.js',
  ] }));
  // The child process stands in for Astro; tests exercise parsing and CLI behavior without a build.
  put(root, 'node_modules/astro/astro.js', 'if (process.env.NOTICE_ANALYZE !== "1") process.exit(1);\n');
  return root;
}
function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [join(root, 'scripts/gen-notice.mjs'), ...args], { cwd: root, encoding: 'utf8' });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('browser NOTICE', () => {
  it('extracts scoped, nested and Windows paths from sourcemap sources', () => {
    expect(packageLocationsFromSources([
      '../../node_modules/@scope/one/dist.js',
      '../../node_modules/outer/node_modules/@inner/two/index.js',
      '..\\node_modules\\plain\\index.js',
      '../src/local.ts',
    ])).toEqual(['node_modules/@scope/one', 'node_modules/outer/node_modules/@inner/two', 'node_modules/plain']);
  });
  it('fails when an installed package has no license body', async () => {
    const root = fixture();
    rmSync(join(root, 'node_modules/alpha/LICENSE'));
    await expect(generateNotice(root)).rejects.toThrow('Missing license text');
    expect(run(root).status).toBe(1);
  });
  it('sorts packages and generates the same output repeatedly without author metadata', async () => {
    const root = fixture();
    const first = await generateNotice(root);
    expect(await generateNotice(root)).toBe(first);
    expect(first.indexOf('### alpha@')).toBeLessThan(first.indexOf('### zeta@'));
    expect(first).toContain('### comlink@');
    expect(first).toContain('### libarchive.js@');
    expect(first).toContain('WASM permission');
    expect(first).not.toContain('private@example.invalid');
  });
  it('--check detects differences and does not rewrite the file', async () => {
    const root = fixture();
    expect(run(root).status).toBe(0);
    expect(run(root, '--check').status).toBe(0);
    await checkNotice(root, readFileSync(join(root, 'NOTICE.md'), 'utf8'));
    put(root, 'NOTICE.md', 'stale');
    expect(run(root, '--check').status).toBe(1);
    expect(readFileSync(join(root, 'NOTICE.md'), 'utf8')).toBe('stale');
  });
});
