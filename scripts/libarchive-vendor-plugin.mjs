import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = realpathSync(path.join(root, 'node_modules/libarchive.js/dist/libarchive.js'));
const packageFile = path.join(root, 'node_modules/libarchive.js/package.json');
const fallback = 'new URL("./worker-bundle.js",import.meta.url)';
const vendorUrl = '"/vendor/libarchive/worker-bundle.js"';

/** Replace only the unused browser fallback before Vite scans asset URLs. */
export function libarchiveVendorPlugin() {
  return {
    name: 'libarchive-vendor-worker',
    enforce: 'pre',
    transform(source, id) {
      if (id.split('?')[0] !== entry) return null;
      const { version } = JSON.parse(readFileSync(packageFile, 'utf8'));
      if (version !== '2.0.2') throw new Error('Unsupported libarchive.js version');
      if (source.split(fallback).length !== 2) {
        throw new Error('Expected one libarchive.js worker fallback URL');
      }
      const start = source.indexOf(fallback);
      const transformed = new MagicString(source);
      transformed.overwrite(start, start + fallback.length, vendorUrl);
      return {
        code: transformed.toString(),
        map: transformed.generateMap({ source: id, includeContent: true, hires: true }),
      };
    },
  };
}
