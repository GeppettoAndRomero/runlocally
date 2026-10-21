import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sniffImageFormat } from '../../src/engine/image/sniff';

const fixture = (name: string) => new Uint8Array(readFileSync(
  fileURLToPath(new URL(`../fixtures/image/${name}`, import.meta.url)),
));
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const box = (type: string, payload: number[] = []) => {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(ascii(type), 4); bytes.set(payload, 8);
  return bytes;
};
const ftyp = (major: string, ...compatible: string[]) =>
  box('ftyp', [...ascii(major), 0, 0, 0, 0, ...ascii(compatible.join(''))]);

describe('image signatures', () => {
  it.each([
    ['alpha.png', 'png'], ['oriented.jpg', 'jpeg'], ['animated.gif', 'gif'],
    ['alpha.webp', 'webp'], ['sample.bmp', 'bmp'], ['sample.ico', 'ico'], ['sample.heic', 'heic'],
  ] as const)('recognizes real %s without modifying its bytes', (name, format) => {
    const bytes = fixture(name), before = bytes.slice();
    expect(sniffImageFormat(bytes)).toBe(format);
    expect(bytes).toEqual(before);
  });
  it('recognizes real AVIF', () => {
    expect(sniffImageFormat(fixture('sample.avif'))).toBe('avif');
  });
  it('requires the complete PNG signature and accepts only valid JPEG marker starts', () => {
    const png = fixture('alpha.png');
    for (let length = 0; length < 8; length++) expect(sniffImageFormat(png.subarray(0, length))).toBe('unknown');
    for (let index = 0; index < 8; index++) {
      const bad = png.slice(0, 8); bad[index] ^= 1;
      expect(sniffImageFormat(bad)).toBe('unknown');
    }
    for (const marker of [0, 0xbf, 0xd8, 0xd9, 0xff]) {
      expect(sniffImageFormat(new Uint8Array([255, 216, 255, marker]))).toBe('unknown');
    }
    expect(sniffImageFormat(new Uint8Array([255, 216, 255, 0xdb]))).toBe('jpeg');
  });
  it('checks GIF versions, both WebP tags, BMP DIB length and ICO count/type', () => {
    expect(sniffImageFormat(new Uint8Array(ascii('GIF87a')))).toBe('gif');
    for (const text of ['GIF89b', 'RIFFxxxxWAVE', 'RIFXxxxxWEBP', 'xxxxxxxxWEBP']) {
      expect(sniffImageFormat(new Uint8Array(ascii(text)))).toBe('unknown');
    }
    const bmp = fixture('sample.bmp');
    for (const size of [0, 13, 0xffffffff]) {
      const bad = bmp.slice(); new DataView(bad.buffer).setUint32(14, size, true);
      expect(sniffImageFormat(bad)).toBe('unknown');
    }
    expect(sniffImageFormat(bmp.subarray(0, 53))).toBe('unknown');
    for (const header of [[0, 0, 1, 0, 0, 0], [1, 0, 1, 0, 1, 0], [0, 0, 2, 0, 1, 0]]) {
      expect(sniffImageFormat(new Uint8Array(header))).toBe('unknown');
    }
    for (const [name, minimum] of [['oriented.jpg', 4], ['animated.gif', 6], ['alpha.webp', 12], ['sample.bmp', 18], ['sample.ico', 6]] as const) {
      const bytes = fixture(name);
      for (let length = 0; length < minimum; length++) expect(sniffImageFormat(bytes.subarray(0, length))).toBe('unknown');
    }
  });
});


describe('bounded ftyp brands', () => {
  it.each([
    ...['avif', 'avis'].map((brand) => [brand, 'avif']),
    ...['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].map((brand) => [brand, 'heic']),
    ['mif1', 'heif'], ['msf1', 'heif'], ['zzzz', 'unknown'],
  ])('recognizes major and compatible %s', (brand, format) => {
    expect(sniffImageFormat(ftyp(brand))).toBe(format);
    expect(sniffImageFormat(ftyp('zzzz', brand))).toBe(format);
  });
  it('prioritizes specifics and rejects conflicts in either order', () => {
    for (const brand of ['avif', 'heic']) {
      expect(sniffImageFormat(ftyp('mif1', 'msf1', brand))).toBe(brand);
      expect(sniffImageFormat(ftyp(brand, 'mif1'))).toBe(brand);
    }
    for (const brands of [['avif', 'heic'], ['heic', 'avif'], ['mif1', 'heic', 'avis']]) {
      expect(sniffImageFormat(ftyp(brands[0], ...brands.slice(1)))).toBe('unknown');
    }
  });
  it('skips bounded boxes and respects subarray offsets without mutation', () => {
    const bytes = new Uint8Array([9, ...box('free'), ...ftyp('avif'), 9]);
    const before = bytes.slice();
    expect(sniffImageFormat(bytes.subarray(1, -1))).toBe('avif');
    expect(bytes).toEqual(before);
  });
  it('rejects truncation, invalid sizes, unaligned brands, and stray strings', () => {
    const valid = ftyp('mif1', 'avif');
    for (let length = 0; length < valid.length; length++) {
      expect(sniffImageFormat(valid.subarray(0, length))).toBe('unknown');
    }
    for (const size of [0, 1, 7, 12, 17, 0xffffffff]) {
      const bad = valid.slice(); new DataView(bad.buffer).setUint32(0, size);
      expect(sniffImageFormat(bad)).toBe('unknown');
    }
    const minor = ftyp('zzzz'); minor.set(ascii('avif'), 12);
    for (const bytes of [minor, box('free', ascii('ftypavif')), ftyp('xavi', 'fxxx'), box('ftyp'), box('free'), new Uint8Array([1, 2, 3])]) {
      expect(sniffImageFormat(bytes)).toBe('unknown');
    }
  });
});
