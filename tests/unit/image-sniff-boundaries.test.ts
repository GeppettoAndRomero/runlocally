import { describe, expect, it } from 'vitest';
import { sniffImageFormat } from '../../src/engine/image/sniff';

const ascii = (text: string) => Array.from(text, char => char.charCodeAt(0));
/** An ftyp box of exactly `size` bytes: major brand, minor version, then compatible brands padded with "zzzz". */
function ftypOfSize(size: number, major: string, ...compatible: string[]) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size);
  bytes.set(ascii('ftyp'), 4);
  bytes.set(ascii(major), 8);
  const brands = compatible.join('');
  bytes.set(ascii(brands), 16);
  for (let offset = 16 + brands.length; offset < size; offset += 4) bytes.set(ascii('zzzz'), offset);
  return bytes;
}

describe('formats whose first four bytes look like an icon header', () => {
  it('does not take a 256-byte ftyp box (00 00 01 00 "ftyp") for an icon', () => {
    const heic = ftypOfSize(256, 'heic', 'mif1');
    expect(Array.from(heic.subarray(0, 8))).toEqual([0, 0, 1, 0, ...ascii('ftyp')]);
    expect(sniffImageFormat(heic)).toBe('heic');
    expect(sniffImageFormat(ftypOfSize(256, 'avif', 'mif1'))).toBe('avif');
    expect(sniffImageFormat(ftypOfSize(256, 'mif1', 'msf1'))).toBe('heif');
  });

  it('still recognizes a real icon header and rejects a cursor or an empty directory', () => {
    // ICONDIR (type 1, one entry) + one ICONDIRENTRY: 16x16, 1 plane, 32 bpp, 100 bytes at offset 22.
    const header = (type: number, count: number) => new Uint8Array([
      0, 0, type, 0, count, 0, 16, 16, 0, 0, 1, 0, 32, 0, 100, 0, 0, 0, 22, 0, 0, 0]);
    expect(sniffImageFormat(header(1, 1))).toBe('ico');
    expect(sniffImageFormat(header(2, 1))).toBe('unknown');
    expect(sniffImageFormat(header(1, 0))).toBe('unknown');
    expect(sniffImageFormat(header(1, 1).subarray(0, 21))).toBe('unknown');
    for (const [index, value] of [[9, 1], [10, 2], [14, 0], [18, 21]] as const) {
      const bytes = header(1, 1);
      if (index === 14) bytes.fill(0, 14, 18); else bytes[index] = value;
      expect(sniffImageFormat(bytes), `entry byte ${index}`).toBe('unknown');
    }
  });

  it('does not take any 256-byte box before an ftyp box for an icon either', () => {
    const free = new Uint8Array(256);
    new DataView(free.buffer).setUint32(0, 256);
    free.set(ascii('free'), 4);
    const bytes = new Uint8Array([...free, ...ftypOfSize(24, 'avif', 'mif1')]);
    expect(sniffImageFormat(bytes)).toBe('avif');
  });
});

describe('JPEG fill bytes', () => {
  const jpeg = (...afterSoi: number[]) => new Uint8Array([0xff, 0xd8, ...afterSoi]);
  it('accepts 0xFF padding before the first marker, as the standard allows', () => {
    expect(sniffImageFormat(jpeg(0xff, 0xe0, 0, 16))).toBe('jpeg');
    expect(sniffImageFormat(jpeg(0xff, 0xff, 0xff, 0xdb, 0, 67))).toBe('jpeg');
  });

  it('rejects a marker that cannot start a JPEG, an unfinished padding run, and a bare SOI', () => {
    for (const rest of [[0xff, 0xff], [0xff], [], [0xff, 0x00], [0xff, 0xd8], [0xff, 0xd9], [0xff, 0xd0], [0xff, 0xbf], [0x00, 0xe0]]) {
      expect(sniffImageFormat(jpeg(...rest)), JSON.stringify(rest)).toBe('unknown');
    }
  });
});
