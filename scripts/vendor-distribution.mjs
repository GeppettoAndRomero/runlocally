import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const vendors = [
  {
    id: 'libarchive', metadata: 'vendor/libarchive-lean', source: 'vendor/libarchive-lean',
    package: 'libarchive.js', version: '2.0.2', install: 'node_modules/libarchive.js/dist',
    files: ['libarchive.wasm', 'libarchive.js', 'libarchive-node.mjs', 'worker-bundle.js', 'worker-bundle-node.mjs'],
    publicFiles: ['libarchive.wasm', 'worker-bundle.js'],
    title: 'Lean libarchive WebAssembly build',
  },
  {
    id: 'libheif', metadata: 'vendor/libheif', source: 'node_modules/libheif-js',
    package: 'libheif-js', version: '1.23.5',
    files: ['libheif-wasm/libheif.wasm', 'libheif-wasm/libheif.js'],
    publicFiles: ['libheif-wasm/libheif.wasm'],
    title: 'libheif WebAssembly distribution',
  },
];
export const publicVendorPath = (vendor, file) => `vendor/${vendor.id}/${file.split('/').at(-1)}`;
export const vendorPaths = vendors.flatMap(vendor => vendor.publicFiles.map(file => publicVendorPath(vendor, file)));

export function verifyVendor(root, vendor, source = join(root, vendor.source), checkVersion = true) {
  if (checkVersion) {
    const installed = JSON.parse(readFileSync(join(root, 'node_modules', vendor.package, 'package.json'), 'utf8'));
    if (installed.version !== vendor.version) throw new Error(`Installed ${vendor.package} must be ${vendor.version}`);
  }
  const lines = readFileSync(join(root, vendor.metadata, 'SHA256SUMS'), 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== vendor.files.length) throw new Error('SHA256SUMS has an invalid file count');
  const expected = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9./-]+)$/.exec(line);
    if (!match || !vendor.files.includes(match[2]) || expected.has(match[2])) throw new Error('SHA256SUMS has an invalid or duplicate entry');
    expected.set(match[2], match[1]);
  }
  for (const file of vendor.files) {
    const digest = createHash('sha256').update(readFileSync(join(source, file))).digest('hex');
    if (digest !== expected.get(file)) throw new Error(`SHA-256 mismatch: ${file}`);
  }
}
export function installVendor(root, vendor) {
  verifyVendor(root, vendor);
  if (vendor.install) for (const file of vendor.files) copyFileSync(join(root, vendor.source, file), join(root, vendor.install, file));
}
export function prepareVendors(root) {
  for (const vendor of vendors) verifyVendor(root, vendor);
  let replacement;
  if (process.env.LIBHEIF_WASM_REPLACEMENT !== undefined) {
    try {
      if (!process.env.LIBHEIF_WASM_REPLACEMENT) throw new Error('file path is empty');
      replacement = readFileSync(resolve(process.env.LIBHEIF_WASM_REPLACEMENT));
      if (!WebAssembly.validate(replacement)) throw new Error('file is empty or is not valid WebAssembly');
      const pinned = new WebAssembly.Module(readFileSync(join(root, vendors[1].source, vendors[1].publicFiles[0])));
      const selected = new WebAssembly.Module(replacement);
      const imports = new Set(WebAssembly.Module.imports(pinned).map(entry => JSON.stringify([entry.module, entry.name, entry.kind])));
      for (const entry of WebAssembly.Module.imports(selected)) {
        if (!imports.has(JSON.stringify([entry.module, entry.name, entry.kind]))) {
          throw new Error(`unsupported import: ${entry.module}/${entry.name} (${entry.kind})`);
        }
      }
      const exports = new Set(WebAssembly.Module.exports(selected).map(entry => JSON.stringify([entry.name, entry.kind])));
      for (const entry of WebAssembly.Module.exports(pinned)) {
        if (!exports.has(JSON.stringify([entry.name, entry.kind]))) {
          throw new Error(`missing export: ${entry.name} (${entry.kind})`);
        }
      }
    } catch (error) {
      throw new Error(`LIBHEIF_WASM_REPLACEMENT: ${error.message}`, { cause: error });
    }
    if (process.env.NOTICE_ANALYZE !== '1') console.warn('LIBHEIF_WASM_REPLACEMENT: 固定版ではない WASM を配布する');
  }
  for (const vendor of vendors) {
    installVendor(root, vendor);
    for (const file of vendor.publicFiles) {
      const destination = join(root, 'public', publicVendorPath(vendor, file));
      mkdirSync(dirname(destination), { recursive: true });
      if (vendor.id === 'libheif' && replacement) writeFileSync(destination, replacement);
      else copyFileSync(join(root, vendor.source, file), destination);
    }
  }
}
