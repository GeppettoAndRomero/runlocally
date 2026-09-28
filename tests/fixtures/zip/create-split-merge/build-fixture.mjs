/**
 * Generates tests/fixtures/zip/create-split-merge/sample.zip — a real, multi-file .zip used by the
 * e2e split spec. Entries are STORED (uncompressed) pseudo-random bytes so the
 * archive is incompressible and its part sizes are predictable when re-packaged.
 *
 * A seeded PRNG reproduces entry contents; ZIP metadata dates are not fixed. Run:  node tests/fixtures/zip/create-split-merge/build-fixture.mjs
 */
import { ZipWriter, BlobWriter, Uint8ArrayReader, configure } from '@zip.js/zip.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

configure({ useWebWorkers: false });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(n, seed) {
  const rnd = mulberry32(seed);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (rnd() * 256) | 0;
  return b;
}

const SIZE = 110 * 1024; // ~110 KB per entry
const entries = [
  'file-1.bin',
  'file-2.bin',
  'file-3.bin',
  'file-4.bin',
  'file-5.bin',
  'data/日本語.bin', // non-ASCII name in a subfolder
];

const writer = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
for (let i = 0; i < entries.length; i++) {
  // level 0 = STORED, so compressedSize == uncompressedSize in the central directory.
  await writer.add(entries[i], new Uint8ArrayReader(randomBytes(SIZE, i + 1)), { level: 0 });
}
const blob = await writer.close();
const bytes = new Uint8Array(await blob.arrayBuffer());

const out = fileURLToPath(new URL('./sample.zip', import.meta.url));
writeFileSync(out, bytes);
console.log(`Wrote ${out} (${bytes.length} bytes, ${entries.length} entries)`);
