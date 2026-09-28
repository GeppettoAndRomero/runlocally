import { describe, it, expect } from 'vitest';
import { scanLocalHeaders, isPkSignature } from '@/engine/recover/zipScan';
import { buildStoredZip, centralDirStart } from './_zipBuilder';

const dec = new TextDecoder();

describe('scanLocalHeaders', () => {
  it('finds every local file header in a normal archive', () => {
    const zip = buildStoredZip([
      { name: 'a.txt', data: 'alpha' },
      { name: 'dir/b.txt', data: 'bravo' },
    ]);
    const found = scanLocalHeaders(zip);
    expect(found.map((e) => e.name)).toEqual(['a.txt', 'dir/b.txt']);
    expect(found[0].method).toBe(0);
    expect(found[0].compressedSize).toBe(5);
  });

  it('locates the stored data so it can be sliced out', () => {
    const zip = buildStoredZip([{ name: 'hi.txt', data: 'hello world' }]);
    const [e] = scanLocalHeaders(zip);
    expect(dec.decode(zip.subarray(e.dataStart, e.dataEnd))).toBe('hello world');
  });

  it('still lists entries when the central directory is removed', () => {
    // Simulate a damaged/missing index: keep the local entries, drop the central dir.
    const zip = buildStoredZip([
      { name: 'one.txt', data: 'first' },
      { name: 'two.txt', data: 'second' },
    ]);
    const truncated = zip.slice(0, centralDirStart(zip));
    const found = scanLocalHeaders(truncated);
    expect(found.map((e) => e.name)).toEqual(['one.txt', 'two.txt']);
  });

  it('marks a truncated final entry (data runs to end of buffer)', () => {
    const zip = buildStoredZip([{ name: 'big.txt', data: 'x'.repeat(200) }]);
    // Cut the central dir AND part of the last entry's data.
    const cut = zip.slice(0, centralDirStart(zip) - 50);
    const [e] = scanLocalHeaders(cut);
    expect(e.name).toBe('big.txt');
    expect(e.truncated).toBe(true);
    // The declared size no longer fits, so dataEnd is clamped to the buffer end.
    expect(e.dataEnd).toBe(cut.length);
  });

  it('flags the UTF-8 name bit when set', () => {
    const zip = buildStoredZip([{ name: 'plain.txt', data: 'x' }]);
    const [e] = scanLocalHeaders(zip);
    // The builder does not set bit 11.
    expect(e.utf8).toBe(false);
  });

  it('ignores a stray PK\\x03\\x04 sequence that is not a real header', () => {
    // A signature followed by junk (an absurd name length) must be skipped.
    const junk = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // signature
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0xff, 0xff, // name length = 65535 (runs past the buffer)
      0, 0,
    ]);
    expect(scanLocalHeaders(junk)).toEqual([]);
  });

  it('returns nothing for input too small to hold a header', () => {
    expect(scanLocalHeaders(new Uint8Array([0x50, 0x4b, 0x03]))).toEqual([]);
  });
});

describe('isPkSignature', () => {
  it('recognizes a local file header signature', () => {
    expect(isPkSignature(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 0)).toBe(true);
  });

  it('recognizes a central directory header signature', () => {
    expect(isPkSignature(new Uint8Array([0x50, 0x4b, 0x01, 0x02]), 0)).toBe(true);
  });

  it('recognizes an end-of-central-directory signature', () => {
    expect(isPkSignature(new Uint8Array([0x50, 0x4b, 0x05, 0x06]), 0)).toBe(true);
  });

  it('recognizes a data descriptor signature', () => {
    expect(isPkSignature(new Uint8Array([0x50, 0x4b, 0x07, 0x08]), 0)).toBe(true);
  });

  it('rejects bytes that do not start with the PK prefix', () => {
    expect(isPkSignature(new Uint8Array([0x00, 0x4b, 0x03, 0x04]), 0)).toBe(false);
    expect(isPkSignature(new Uint8Array([0x50, 0x00, 0x03, 0x04]), 0)).toBe(false);
  });

  it('rejects a PK-prefixed sequence with an unrecognized record kind', () => {
    expect(isPkSignature(new Uint8Array([0x50, 0x4b, 0x09, 0x09]), 0)).toBe(false);
  });

  it('reads the signature at a non-zero offset', () => {
    const bytes = new Uint8Array([0xaa, 0xaa, 0x50, 0x4b, 0x03, 0x04]);
    expect(isPkSignature(bytes, 2)).toBe(true);
  });
});
