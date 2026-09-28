import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = process.cwd();
const files = ['libarchive.wasm', 'libarchive.js', 'libarchive-node.mjs', 'worker-bundle.js', 'worker-bundle-node.mjs'];
const roots: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vendor-libarchive-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'vendor/libarchive-lean'), { recursive: true });
  mkdirSync(join(root, 'node_modules/libarchive.js/dist'), { recursive: true });
  copyFileSync(join(repo, 'scripts/vendor-libarchive.mjs'), join(root, 'scripts/vendor-libarchive.mjs'));
  for (const file of [...files, 'SHA256SUMS']) {
    copyFileSync(join(repo, 'vendor/libarchive-lean', file), join(root, 'vendor/libarchive-lean', file));
  }
  writeFileSync(join(root, 'node_modules/libarchive.js/package.json'), '{"version":"2.0.2"}');
  for (const file of files) writeFileSync(join(root, 'node_modules/libarchive.js/dist', file), 'original');
  return root;
}
function run(root: string, verify = false) {
  return spawnSync(process.execPath, ['scripts/vendor-libarchive.mjs', ...(verify ? ['--verify'] : [])], { cwd: root, encoding: 'utf8' });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('vendor-libarchive', () => {
  it('verifies without mutation, copies all five files and the browser pair, and can run again', () => {
    const root = setup();
    expect(run(root, true).status).toBe(0);
    expect(readFileSync(join(root, 'node_modules/libarchive.js/dist/libarchive.js'), 'utf8')).toBe('original');
    expect(existsSync(join(root, 'public/vendor/libarchive'))).toBe(false);
    expect(run(root).status).toBe(0);
    expect(run(root).status).toBe(0);
    for (const file of files) {
      expect(readFileSync(join(root, 'node_modules/libarchive.js/dist', file)))
        .toEqual(readFileSync(join(root, 'vendor/libarchive-lean', file)));
    }
    expect(readdirSync(join(root, 'public/vendor/libarchive')).sort()).toEqual(['libarchive.wasm', 'worker-bundle.js']);
    for (const file of ['worker-bundle.js', 'libarchive.wasm']) {
      expect(readFileSync(join(root, 'public/vendor/libarchive', file)))
        .toEqual(readFileSync(join(root, 'vendor/libarchive-lean', file)));
    }
  });

  it('rejects mismatches, missing files, and malformed manifests before copying', () => {
    for (const damage of [
      (root: string) => writeFileSync(join(root, 'vendor/libarchive-lean/libarchive.js'), 'changed'),
      (root: string) => rmSync(join(root, 'vendor/libarchive-lean/libarchive.wasm')),
      (root: string) => writeFileSync(join(root, 'vendor/libarchive-lean/SHA256SUMS'), 'bad\n'),
      (root: string) => {
        const file = join(root, 'vendor/libarchive-lean/SHA256SUMS');
        const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
        writeFileSync(file, [...lines.slice(0, -1), lines[0]].join('\n') + '\n');
      },
      (root: string) => {
        const file = join(root, 'vendor/libarchive-lean/SHA256SUMS');
        writeFileSync(file, readFileSync(file, 'utf8').replace('libarchive.wasm', '../libarchive.wasm'));
      },
    ]) {
      const root = setup();
      damage(root);
      expect(run(root, true).status).toBe(1);
      expect(run(root).status).toBe(1);
      expect(readFileSync(join(root, 'node_modules/libarchive.js/dist/libarchive.js'), 'utf8')).toBe('original');
    }
  });

  it('does not patch an installed version other than 2.0.2', () => {
    const root = setup();
    writeFileSync(join(root, 'node_modules/libarchive.js/package.json'), '{"version":"2.0.1"}');
    expect(run(root).status).toBe(1);
    expect(readFileSync(join(root, 'node_modules/libarchive.js/dist/libarchive.js'), 'utf8')).toBe('original');
  });
});
