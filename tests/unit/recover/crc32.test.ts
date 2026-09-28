import { describe, it, expect } from 'vitest';
import { crc32 } from '@/engine/recover/crc32';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('matches the standard "123456789" check value', () => {
    // The canonical CRC-32/ISO-HDLC check value.
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('matches a known vector', () => {
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('changes when a byte changes', () => {
    const a = crc32(bytes('hello'));
    const b = crc32(bytes('hellp'));
    expect(a).not.toBe(b);
  });

  it('returns an unsigned 32-bit integer', () => {
    const v = crc32(bytes('\xff\xff\xff\xff'));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});
