import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareVendors, vendorPaths } from '../../scripts/vendor-distribution.mjs';
import { sitePagePaths, transformPrecache } from '../../scripts/pwa-manifest.mjs';

const asset = 'vendor/libheif/libheif.wasm';
const pinned = readFileSync('node_modules/libheif-js/libheif-wasm/libheif.wasm');
// Custom section with a one-byte name and payload; it changes no executable code.
const compatible = Buffer.concat([pinned, Buffer.from([0, 3, 1, 120, 0])]);
function withoutExports(bytes: Buffer) {
  let offset = 8;
  while (offset < bytes.length) {
    const start = offset;
    const id = bytes[offset++];
    let size = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[offset++];
      size += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    offset += size;
    if (id === 7) return Buffer.concat([bytes.subarray(0, start), bytes.subarray(offset)]);
  }
  throw new Error('Expected export section');
}
let root: string;
beforeEach(() => {
  vi.stubEnv('LIBHEIF_WASM_REPLACEMENT', undefined);
  vi.stubEnv('NOTICE_ANALYZE', undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  root = mkdtempSync(join(tmpdir(), 'libheif-replacement-'));
  cpSync('vendor', join(root, 'vendor'), { recursive: true });
  for (const name of ['libarchive.js', 'libheif-js']) {
    cpSync(join('node_modules', name), join(root, 'node_modules', name), { recursive: true });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
function select(bytes: Buffer) {
  const path = join(root, 'replacement.wasm');
  writeFileSync(path, bytes);
  vi.stubEnv('LIBHEIF_WASM_REPLACEMENT', path);
  return path;
}
describe('libheif WASM replacement', () => {
  it('keeps the pinned distribution and hash verification when unset', () => {
    prepareVendors(root);
    expect(readFileSync(join(root, 'public', asset))).toEqual(pinned);
    expect(console.warn).not.toHaveBeenCalled();
    writeFileSync(join(root, 'node_modules/libheif-js/libheif-wasm/libheif.wasm'), compatible);
    expect(() => prepareVendors(root)).toThrow('SHA-256 mismatch');
  });
  it.each(['absolute', 'relative'])('copies compatible bytes unchanged using a %s path and preserves selection on rebuild', mode => {
    expect(WebAssembly.validate(compatible)).toBe(true);
    const original = new WebAssembly.Module(pinned);
    const modified = new WebAssembly.Module(compatible);
    expect(WebAssembly.Module.imports(modified)).toEqual(WebAssembly.Module.imports(original));
    expect(WebAssembly.Module.exports(modified)).toEqual(WebAssembly.Module.exports(original));
    const path = select(compatible);
    if (mode === 'relative') vi.stubEnv('LIBHEIF_WASM_REPLACEMENT', relative(process.cwd(), path));
    for (let i = 0; i < 2; i++) {
      prepareVendors(root);
      expect(readFileSync(join(root, 'public', asset))).toEqual(compatible);
    }
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith('LIBHEIF_WASM_REPLACEMENT: 固定版ではない WASM を配布する');
    expect(readFileSync(join(root, 'node_modules/libheif-js/libheif-wasm/libheif.wasm'))).toEqual(pinned);
  });
  it.each([
    ['non-WASM', Buffer.from('not wasm'), 'not valid WebAssembly'],
    ['empty', Buffer.alloc(0), 'empty'],
    // Valid module importing an additional function from x/y.
    ['extra import', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 7, 1, 1, 120, 1, 121, 0, 0]), 'unsupported import: x/y (function)'],
    ['missing exports', withoutExports(pinned), 'missing export:'],
  ])('rejects %s without replacing an existing public file', (_label, bytes, reason) => {
    prepareVendors(root);
    select(bytes);
    if (reason === 'missing export:' || reason.startsWith('unsupported')) expect(WebAssembly.validate(bytes)).toBe(true);
    expect(() => prepareVendors(root)).toThrow(reason);
    expect(readFileSync(join(root, 'public', asset))).toEqual(pinned);
  });
  it.each(['missing.wasm', '', '.'])('rejects an absent, empty or unreadable file path (%s)', path => {
    vi.stubEnv('LIBHEIF_WASM_REPLACEMENT', path ? join(root, path) : '');
    expect(() => prepareVendors(root)).toThrow('LIBHEIF_WASM_REPLACEMENT:');
  });
  it('updates precache revision and integrity from the selected public bytes', async () => {
    const entries = [
      ...[...sitePagePaths()].map(url => ({ url: `${url.slice(1)}index.html` })),
      ...['manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png', 'SECURITY.md', '_astro/worker-test.js', ...vendorPaths].map(url => ({ url })),
    ];
    prepareVendors(root);
    const before = (await transformPrecache(entries, join(root, 'public'))).manifest;
    select(compatible);
    prepareVendors(root);
    const after = (await transformPrecache(entries, join(root, 'public'))).manifest;
    const previous = before.find((entry: { url: string }) => entry.url === asset);
    const selected = after.find((entry: { url: string }) => entry.url === asset);
    expect(selected.revision).not.toBe(previous.revision);
    expect(selected.integrity).not.toBe(previous.integrity);
    expect(selected.integrity).toBe(`sha256-${createHash('sha256').update(compatible).digest('base64')}`);
    for (const path of vendorPaths.filter(path => path !== asset)) {
      expect(after.find((entry: { url: string }) => entry.url === path)).toEqual(before.find((entry: { url: string }) => entry.url === path));
    }
  });
});
