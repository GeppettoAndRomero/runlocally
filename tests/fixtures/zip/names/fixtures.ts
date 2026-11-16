import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { expect } from 'vitest';

// Independently generated with Python str.encode(codec); CP437 follows Unicode table 2.00:
// https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT
export const nameCases = [
  { encoding: 'shift_jis', name: 'ソ/メモ帳.txt', bytes: [0x83, 0x5c, 0x2f, 0x83, 0x81, 0x83, 0x82, 0x92, 0xa0, 0x2e, 0x74, 0x78, 0x74] },
  { encoding: 'cp437', name: 'café.txt', bytes: [0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74] },
  { encoding: 'gbk', name: '中文.txt', bytes: [0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x74, 0x78, 0x74] },
  { encoding: 'gb18030', name: '\u{10000}.txt', bytes: [0x90, 0x30, 0x81, 0x30, 0x2e, 0x74, 0x78, 0x74] },
  { encoding: 'big5', name: '中文.txt', bytes: [0xa4, 0xa4, 0xa4, 0xe5, 0x2e, 0x74, 0x78, 0x74] },
  { encoding: 'euc-kr', name: '한글.txt', bytes: [0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74] },
] as const;

export async function makeNameZip(rawName: Uint8Array, options: {
  utf8?: boolean; unicodePath?: Uint8Array; directory?: boolean;
} = {}): Promise<File> {
  const placeholder = 'x'.repeat(rawName.length - (options.directory ? 1 : 0)) + (options.directory ? '/' : '');
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
  let blob: Blob;
  try {
    await writer.add(placeholder, options.directory ? undefined : new TextReader('filename fixture content'), {
      directory: options.directory, level: 0, lastModDate: new Date('2020-02-04T12:30:00Z'),
      extendedTimestamp: false, ntfsTimestamp: false,
      ...(options.unicodePath ? { extraField: new Map([[0x7075, options.unicodePath]]) } : {}),
    });
    blob = await writer.close();
  } catch (error) { try { await writer.close(); } catch { /* Preserve first failure. */ } throw error; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  // This writer emits no archive comment: follow EOCD -> central -> local offset.
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(1);
  const central = view.getUint32(end + 16, true);
  expect(view.getUint32(central, true)).toBe(0x02014b50);
  const local = view.getUint32(central + 42, true);
  expect(view.getUint32(local, true)).toBe(0x04034b50);
  for (const [header, lengthOffset, nameOffset, flagOffset] of [[central, 28, 46, 8], [local, 26, 30, 6]]) {
    expect(view.getUint16(header + lengthOffset, true)).toBe(rawName.length);
    expect(bytes.slice(header + nameOffset, header + nameOffset + rawName.length)).toEqual(new TextEncoder().encode(placeholder));
    bytes.set(rawName, header + nameOffset);
    const flag = (view.getUint16(header + flagOffset, true) & ~0x800) | (options.utf8 ? 0x800 : 0);
    view.setUint16(header + flagOffset, flag, true);
    expect(bytes.slice(header + nameOffset, header + nameOffset + rawName.length)).toEqual(rawName);
    expect(view.getUint16(header + flagOffset, true)).toBe(flag);
    expect(Boolean(flag & 0x800)).toBe(Boolean(options.utf8));
  }
  return new File([bytes], 'names.zip');
}
