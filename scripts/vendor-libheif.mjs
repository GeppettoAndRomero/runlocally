#!/usr/bin/env node
/** Verify the pinned libheif WASM/glue pair without installing or copying it. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const files = ['libheif-wasm/libheif.wasm', 'libheif-wasm/libheif.js'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmRoot = path.join(root, 'node_modules/libheif-js');

function verify(source) {
  const installed = JSON.parse(readFileSync(path.join(npmRoot, 'package.json'), 'utf8'));
  if (installed.version !== '1.23.5') throw new Error('Installed libheif-js must be 1.23.5');
  const manifest = readFileSync(path.join(root, 'vendor/libheif/SHA256SUMS'), 'utf8');
  const lines = manifest.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== files.length) throw new Error('SHA256SUMS must list exactly two files');
  const expected = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}(libheif-wasm\/libheif\.(?:wasm|js))$/.exec(line);
    if (!match || !files.includes(match[2]) || expected.has(match[2])) {
      throw new Error('SHA256SUMS has an invalid or duplicate entry');
    }
    expected.set(match[2], match[1]);
  }
  for (const file of files) {
    const digest = createHash('sha256').update(readFileSync(path.join(source, file))).digest('hex');
    if (digest !== expected.get(file)) throw new Error(`SHA-256 mismatch: ${file}`);
  }
}

try {
  const args = process.argv.slice(2);
  let source = npmRoot;
  if (args.length === 2 && args[0] === '--from' && args[1] && !args[1].startsWith('-')) {
    source = path.resolve(args[1]);
  } else if (args.length !== 0 && !(args.length === 1 && args[0] === '--verify')) {
    throw new Error('Usage: node scripts/vendor-libheif.mjs [--verify | --from <dir>]');
  }
  verify(source);
  console.log('vendor-libheif: verified pinned WASM/glue pair');
} catch (error) {
  console.error(`vendor-libheif: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
