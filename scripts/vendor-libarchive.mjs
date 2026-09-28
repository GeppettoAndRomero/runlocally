#!/usr/bin/env node
/** Verify and install the matched lean libarchive.js build. */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const files = [
  'libarchive.wasm',
  'libarchive.js',
  'libarchive-node.mjs',
  'worker-bundle.js',
  'worker-bundle-node.mjs',
];
const browserFiles = ['worker-bundle.js', 'libarchive.wasm'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'vendor/libarchive-lean');
const npmRoot = path.join(root, 'node_modules/libarchive.js');
const npmDist = path.join(npmRoot, 'dist');
const browserDist = path.join(root, 'public/vendor/libarchive');

function verify() {
  const manifest = readFileSync(path.join(source, 'SHA256SUMS'), 'utf8');
  const lines = manifest.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== files.length) throw new Error('SHA256SUMS must list exactly five files');
  const expected = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9.-]+)$/.exec(line);
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
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--verify')) {
    throw new Error('Usage: node scripts/vendor-libarchive.mjs [--verify]');
  }
  verify();
  if (process.argv[2] !== '--verify') {
    const installed = JSON.parse(readFileSync(path.join(npmRoot, 'package.json'), 'utf8'));
    if (installed.version !== '2.0.2') throw new Error('Installed libarchive.js must be 2.0.2');
    for (const file of files) copyFileSync(path.join(source, file), path.join(npmDist, file));
    mkdirSync(browserDist, { recursive: true });
    for (const file of browserFiles) copyFileSync(path.join(npmDist, file), path.join(browserDist, file));
  }
  console.log(`vendor-libarchive: ${process.argv[2] === '--verify' ? 'verified' : 'installed'} matched build`);
} catch (error) {
  console.error(`vendor-libarchive: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
