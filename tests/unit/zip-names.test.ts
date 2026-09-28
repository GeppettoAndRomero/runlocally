import { describe, it, expect } from 'vitest';
import { decodeShiftJisName } from '../../src/engine/zip/names';

describe('decodeShiftJisName', () => {
  const rawFilename = new Uint8Array([0x83, 0x81, 0x83, 0x82, 0x92, 0xa0, 0x2e, 0x74, 0x78, 0x74]);
  it('decodes Shift_JIS bytes when the UTF-8 flag is absent', () => {
    expect(decodeShiftJisName({ name: 'garbled.txt', utf8: false, rawFilename })).toBe('メモ帳.txt');
  });
  it('preserves a UTF-8 name even when raw bytes exist', () => {
    expect(decodeShiftJisName({ name: '日本語.txt', utf8: true, rawFilename })).toBe('日本語.txt');
  });
  it('preserves the name when raw bytes are absent or decode to empty', () => {
    expect(decodeShiftJisName({ name: 'a.txt', utf8: false })).toBe('a.txt');
    expect(decodeShiftJisName({ name: 'a.txt', utf8: false, rawFilename: new Uint8Array() })).toBe('a.txt');
  });
});
