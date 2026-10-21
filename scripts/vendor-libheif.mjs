#!/usr/bin/env node
/** Verify the pinned libheif WASM/glue pair without installing or copying it. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { vendors, verifyVendor } from './vendor-distribution.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmRoot = path.join(root, 'node_modules/libheif-js');

try {
  const args = process.argv.slice(2);
  let source = npmRoot;
  if (args.length === 2 && args[0] === '--from' && args[1] && !args[1].startsWith('-')) {
    source = path.resolve(args[1]);
  } else if (args.length !== 0 && !(args.length === 1 && args[0] === '--verify')) {
    throw new Error('Usage: node scripts/vendor-libheif.mjs [--verify | --from <dir>]');
  }
  verifyVendor(root, vendors[1], source);
  console.log('vendor-libheif: verified pinned WASM/glue pair');
} catch (error) {
  console.error(`vendor-libheif: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
