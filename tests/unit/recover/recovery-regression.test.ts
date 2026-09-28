import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from '@/engine/recover/crc32';
import { recoverZip } from '@/engine/recover/recoverEngine';
import { scanLocalHeaders } from '@/engine/recover/zipScan';
import { buildStoredZip, centralDirStart } from './_zipBuilder';

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array | null) => value === null ? null : new TextDecoder().decode(value);

// Construct local records without a central index to exercise the scan path.
function localRecord(name: string, content: Uint8Array, options: {
  method?: number;
  flag?: number;
  declaredSize?: number;
  crc?: number;
  descriptor?: boolean;
} = {}): Uint8Array {
  const nameBytes = encode(name);
  const method = options.method ?? 0;
  const compressed = method === 8 ? new Uint8Array(deflateRawSync(content)) : content;
  const descriptor = options.descriptor ?? false;
  const out = new Uint8Array(30 + nameBytes.length + compressed.length + (descriptor ? 16 : 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, options.flag ?? (descriptor ? 8 : 0), true);
  view.setUint16(8, method, true);
  view.setUint32(14, descriptor ? 0 : (options.crc ?? crc32(content)), true);
  view.setUint32(18, descriptor ? 0 : (options.declaredSize ?? compressed.length), true);
  view.setUint32(22, descriptor ? 0 : content.length, true);
  view.setUint16(26, nameBytes.length, true);
  out.set(nameBytes, 30);
  out.set(compressed, 30 + nameBytes.length);
  if (descriptor) {
    const at = 30 + nameBytes.length + compressed.length;
    view.setUint32(at, 0x08074b50, true);
    view.setUint32(at + 4, crc32(content), true);
    view.setUint32(at + 8, compressed.length, true);
    view.setUint32(at + 12, content.length, true);
  }
  return out;
}

describe('recovery result contract', () => {
  it('counts central directories separately from recovered files', async () => {
    const result = await recoverZip(buildStoredZip([
      { name: 'folder/', data: '' },
      { name: 'folder/file.txt', data: 'present' },
    ]));
    expect(result.source).toBe('central');
    expect(result.entries[0]).toMatchObject({
      name: 'folder/', directory: true, status: 'ok', bytes: null,
      size: 0, expectedSize: 0, via: 'central',
    });
    expect([result.total, result.recovered]).toEqual([1, 1]);
  });

  it('marks an encrypted central entry as broken without failing the archive', async () => {
    const zip = buildStoredZip([{ name: 'secret.txt', data: 'content' }]);
    const central = centralDirStart(zip);
    const view = new DataView(zip.buffer);
    view.setUint16(6, 1, true);
    view.setUint16(central + 8, 1, true);
    const result = await recoverZip(zip);
    expect(result.source).toBe('central');
    expect(result.entries[0]).toMatchObject({
      name: 'secret.txt', directory: false, status: 'broken', bytes: null,
      size: 0, expectedSize: 7, via: 'central', reason: 'encrypted',
    });
    expect([result.total, result.recovered]).toEqual([1, 0]);
  });

  it('accepts ArrayBuffer input with the same result as Uint8Array', async () => {
    const zip = buildStoredZip([{ name: 'file.txt', data: 'content' }]);
    const fromBytes = await recoverZip(zip);
    const fromBuffer = await recoverZip(zip.buffer as ArrayBuffer);
    expect(fromBuffer).toEqual(fromBytes);
  });
});

describe('local-header recovery branches', () => {
  it('recovers a STORED file and directory without a central index', async () => {
    const zip = buildStoredZip([
      { name: 'folder/', data: '' },
      { name: 'folder/file.txt', data: 'contents' },
    ]);
    const result = await recoverZip(zip.slice(0, centralDirStart(zip)));
    expect(result.source).toBe('scan');
    expect(result.entries[0]).toMatchObject({ directory: true, status: 'ok', bytes: null, via: 'scan' });
    expect(result.entries[1]).toMatchObject({ status: 'ok', size: 8, via: 'scan' });
    expect([result.total, result.recovered]).toEqual([1, 1]);
  });

  it('inflates a DEFLATE local record', async () => {
    const content = encode('compressible content '.repeat(20));
    const result = await recoverZip(localRecord('deflated.txt', content, { method: 8 }));
    expect(result.source).toBe('scan');
    expect(result.entries[0]).toMatchObject({ status: 'ok', via: 'scan', expectedSize: content.length });
    expect(result.entries[0].bytes).toEqual(content);
  });

  it('retains decoded DEFLATE bytes when its local CRC is wrong', async () => {
    const content = encode('deflated content '.repeat(20));
    const result = await recoverZip(localRecord('bad-deflate.txt', content, { method: 8, crc: 1 }));
    expect(result.entries[0]).toMatchObject({ status: 'broken', reason: 'crc', size: content.length });
    expect(result.entries[0].bytes).toEqual(content);
  });

  it('reports a cut DEFLATE stream as truncated', async () => {
    const content = encode('deflated content '.repeat(20));
    const complete = localRecord('cut-deflate.txt', content, { method: 8 });
    const result = await recoverZip(complete.slice(0, -2));
    expect(result.entries[0]).toMatchObject({ status: 'broken', reason: 'truncated' });
  });

  it('keeps partial STORED bytes and reports truncation', async () => {
    const record = localRecord('cut.txt', encode('abcdef'), { declaredSize: 12 });
    const result = await recoverZip(record);
    expect(result.entries[0]).toMatchObject({
      status: 'broken', reason: 'truncated', size: 6, expectedSize: 6,
    });
    expect(decode(result.entries[0].bytes)).toBe('abcdef');
  });

  it('reports unsupported entries and the current zero-byte scan result', async () => {
    const unsupported = await recoverZip(localRecord('unknown.bin', encode('payload'), { method: 12 }));
    expect(unsupported.entries[0]).toMatchObject({ status: 'broken', reason: 'unsupported', bytes: null });
    const empty = await recoverZip(localRecord('empty.txt', new Uint8Array()));
    // A zero-size local record at end of input is classified as truncated by the scanner.
    expect(empty.entries[0]).toMatchObject({ status: 'broken', reason: 'truncated', bytes: null, size: 0 });
  });

  it('reads data up to a signed descriptor and does not include the descriptor', async () => {
    const record = localRecord('descriptor.txt', encode('stored data'), { descriptor: true });
    const [scanned] = scanLocalHeaders(record);
    expect(scanned.hasDataDescriptor).toBe(true);
    expect(scanned.truncated).toBe(false);
    const result = await recoverZip(record);
    expect(result.entries[0]).toMatchObject({ status: 'ok', via: 'scan', expectedSize: null });
    expect(decode(result.entries[0].bytes)).toBe('stored data');
  });

  it('rejects a plausible-looking false header with a NUL name', async () => {
    const falseHeader = localRecord('bad.txt', encode('payload'));
    falseHeader[31] = 0;
    expect(scanLocalHeaders(falseHeader)).toEqual([]);
    expect((await recoverZip(falseHeader)).entries).toEqual([]);
  });

  it('checks the local CRC when recovering without a central index', async () => {
    const result = await recoverZip(localRecord('bad-crc.txt', encode('contents'), { crc: 1 }));
    expect(result.entries[0]).toMatchObject({ status: 'broken', reason: 'crc', size: 8 });
    expect(decode(result.entries[0].bytes)).toBe('contents');
  });
});
