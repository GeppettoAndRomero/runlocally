import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = process.cwd();
const files = ['libheif-wasm/libheif.wasm', 'libheif-wasm/libheif.js'];
const roots: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vendor-libheif-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(join(repo, 'scripts/vendor-distribution.mjs'), join(root, 'scripts/vendor-distribution.mjs'));
  mkdirSync(join(root, 'vendor/libheif'), { recursive: true });
  mkdirSync(join(root, 'node_modules/libheif-js/libheif-wasm'), { recursive: true });
  copyFileSync(join(repo, 'scripts/vendor-libheif.mjs'), join(root, 'scripts/vendor-libheif.mjs'));
  copyFileSync(join(repo, 'vendor/libheif/SHA256SUMS'), join(root, 'vendor/libheif/SHA256SUMS'));
  copyFileSync(join(repo, 'node_modules/libheif-js/package.json'), join(root, 'node_modules/libheif-js/package.json'));
  for (const file of files) {
    copyFileSync(join(repo, 'node_modules/libheif-js', file), join(root, 'node_modules/libheif-js', file));
  }
  return root;
}
function run(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(root, 'scripts/vendor-libheif.mjs'), ...args], { cwd: root, encoding: 'utf8' });
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(relative: string) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const file = join(relative, entry.name);
      if (entry.isDirectory()) walk(file);
      else result[file] = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
    }
  }
  walk('');
  return result;
}
function unchanged(root: string, args: string[], status: number) {
  const before = snapshot(root);
  const result = run(root, args);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(status);
  expect(snapshot(root)).toEqual(before);
  expect(existsSync(join(root, 'public'))).toBe(false);
  expect(existsSync(join(root, 'dist'))).toBe(false);
  return result;
}
function editManifest(root: string, edit: (lines: string[]) => string[]) {
  const file = join(root, 'vendor/libheif/SHA256SUMS');
  writeFileSync(file, edit(readFileSync(file, 'utf8').trimEnd().split('\n')).join('\n') + '\n');
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('vendor-libheif', () => {
  it('verifies the installed pair without writes and can run again', () => {
    const result = run(repo, ['--verify']);
    expect(result.status, result.stderr).toBe(0);
    const root = setup();
    for (const args of [[], ['--verify'], [], ['--verify']]) unchanged(root, args, 0);
  });

  it('checks the installed version in every mode', () => {
    const root = setup();
    writeFileSync(join(root, 'node_modules/libheif-js/package.json'), '{"version":"1.23.4"}');
    for (const args of [[], ['--verify'], ['--from', 'node_modules/libheif-js']]) {
      expect(unchanged(root, args, 1).stderr).toContain('must be 1.23.5');
    }
  });

  it('rejects damaged pairs and invalid manifests without writes on repeated attempts', () => {
    const damage: ((root: string) => void)[] = [
      ...files.map(file => (root: string) => writeFileSync(join(root, 'node_modules/libheif-js', file), 'changed')),
      ...files.map(file => (root: string) => rmSync(join(root, 'node_modules/libheif-js', file))),
      root => writeFileSync(join(root, 'vendor/libheif/SHA256SUMS'), 'bad\n'),
      root => editManifest(root, lines => lines.slice(0, 1)),
      root => editManifest(root, lines => [lines[0], lines[0]]),
      root => editManifest(root, lines => [...lines, lines[0]]),
      root => editManifest(root, lines => [lines[0].replace(/^[0-9a-f]/, 'z'), lines[1]]),
      root => editManifest(root, lines => [lines[0].replace('  ', ' '), lines[1]]),
      ...['unknown.wasm', '../libheif.wasm', '/libheif.wasm', 'libheif-wasm/../libheif.wasm',
        'libheif-wasm/./libheif.wasm', 'libheif-wasm\\libheif.wasm'].map(file =>
        (root: string) => editManifest(root, lines => [lines[0].replace(files[0], file), lines[1]])),
    ];
    for (const corrupt of damage) {
      const root = setup();
      corrupt(root);
      for (const args of [[], ['--verify'], []]) unchanged(root, args, 1);
    }
  });

  it('rejects invalid arguments without writes', () => {
    const root = setup();
    for (const args of [['--unknown'], ['--verify', 'extra'], ['--from'], ['--from', ''],
      ['--from', '--verify'], ['--from', '.', 'extra'], ['--verify', '--from', '.']]) {
      expect(unchanged(root, args, 1).stderr).toContain('Usage:');
    }
  });

  it('verifies a replacement pair against the pinned manifest without copying it', () => {
    const root = setup();
    mkdirSync(join(root, 'replacement/libheif-wasm'), { recursive: true });
    for (const file of files) {
      copyFileSync(join(root, 'node_modules/libheif-js', file), join(root, 'replacement', file));
    }
    for (const source of ['replacement', join(root, 'replacement')]) {
      unchanged(root, ['--from', source], 0);
      unchanged(root, ['--from', source], 0);
    }
    for (const file of files) {
      const original = readFileSync(join(root, 'replacement', file));
      writeFileSync(join(root, 'replacement', file), 'changed');
      for (let i = 0; i < 2; i++) unchanged(root, ['--from', 'replacement'], 1);
      rmSync(join(root, 'replacement', file));
      unchanged(root, ['--from', 'replacement'], 1);
      writeFileSync(join(root, 'replacement', file), original);
    }
    unchanged(root, ['--from', 'missing'], 1);
    unchanged(root, [], 0);
  });

  it('reports the runtime version and the complete codec descriptor counts', () => {
    const result = spawnSync(process.execPath, ['-e', `
      const m = require('./wasm');
      const counts = Array.from({ length: 10 }, (_, i) => [
        m._heif_get_encoder_descriptors(i + 1, 0, 0, 0),
        m._heif_get_decoder_descriptors(i + 1, 0, 0)
      ]);
      const p = m._malloc(4);
      m._heif_get_encoder_descriptors(9, 0, p, 1);
      const d = m.HEAPU32[p / 4];
      const start = m._heif_encoder_descriptor_get_name(d);
      let end = start;
      while (m.HEAPU8[end]) end++;
      const name = Buffer.from(m.HEAPU8.subarray(start, end)).toString();
      const format = m._heif_encoder_descriptor_get_compression_format(d);
      m._free(p);
      console.log(JSON.stringify({ version: m.heif_get_version(), counts, name, format }));
    `], { cwd: join(repo, 'node_modules/libheif-js'), encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: '1.23.5',
      counts: [[0, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1, 0], [0, 0]],
      name: 'mask', format: 9,
    });
  });
});
