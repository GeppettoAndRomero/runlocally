import { describe, expect, it } from 'vitest';
import { sniffArchiveKind } from '../../src/engine/sniff';

describe('archive signatures', () => {
  it.each([
    [[0x50, 0x4b, 0x03, 0x04], 'zip'], [[0x50, 0x4b, 0x05, 0x06], 'zip'],
    [[0x50, 0x4b, 0x07, 0x08], 'zip'],
    [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], 'rar'],
    [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00], 'rar'],
    [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], '7z'],
  ] as const)('recognizes %j', (signature, kind) => {
    const bytes = new Uint8Array(signature);
    expect(sniffArchiveKind(bytes)).toBe(kind);
    expect([...bytes]).toEqual([...signature]);
  });
  it('requires a ustar marker at offset 257', () => {
    const bytes = new Uint8Array(263);
    bytes.set([117, 115, 116, 97, 114, 0], 257);
    expect(sniffArchiveKind(bytes.subarray(0, 262))).toBe('unknown');
    expect(sniffArchiveKind(bytes)).toBe('tar');
    bytes[262] = 32;
    expect(sniffArchiveKind(bytes)).toBe('tar');
    bytes[262] = 1;
    expect(sniffArchiveKind(bytes)).toBe('unknown');
    bytes[262] = 0;
    bytes[257] = 0;
    expect(sniffArchiveKind(bytes)).toBe('unknown');
  });
  it.each([[], [0x50], [0x50, 0x4b, 0x03], [0x1f, 0x8b], [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x02]])('rejects incomplete and nearby signatures', (...bytes) => {
    expect(sniffArchiveKind(new Uint8Array(bytes))).toBe('unknown');
  });
});
