#!/usr/bin/env node
/** Verify and install the matched lean libarchive.js build. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { vendors, verifyVendor, installVendor } from './vendor-distribution.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = vendors[0];

try {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--verify')) {
    throw new Error('Usage: node scripts/vendor-libarchive.mjs [--verify]');
  }
  if (process.argv[2] === '--verify') verifyVendor(root, vendor, undefined, false);
  else installVendor(root, vendor);
  console.log(`vendor-libarchive: ${process.argv[2] === '--verify' ? 'verified' : 'installed'} matched build`);
} catch (error) {
  console.error(`vendor-libarchive: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
