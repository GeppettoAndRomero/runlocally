import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crc32 } from '@/engine/recover/crc32';
import { recoverZip } from '@/engine/recover/recoverEngine';
import { scanLocalHeaders } from '@/engine/recover/zipScan';
import { nextRecordBoundary, trailingDescriptors } from '@/engine/recover/zipDescriptors';

const encode = (text: string) => new TextEncoder().encode(text);
const payload = encode('Recover this complete deflate stream. '.repeat(30));
const nativeDecompressionStream = globalThis.DecompressionStream;

type Descriptor = 'signed32' | 'unsigned32' | 'signed64' | 'unsigned64';

function record(options: {
  descriptor?: Descriptor;
  crc?: number;
  trailing?: Uint8Array;
  cut?: number;
  content?: Uint8Array;
} = {}): Uint8Array {
  const name = encode('recovered.txt');
  const content = options.content ?? payload;
  const compressed = new Uint8Array(deflateRawSync(content));
  const tail = options.trailing ?? new Uint8Array();
  const kind = options.descriptor;
  const signed = kind?.startsWith('signed') ?? false;
  const zip64 = kind?.endsWith('64') ?? false;
  const descriptorLength = kind ? (signed ? 4 : 0) + (zip64 ? 20 : 12) : 0;
  const dataLength = compressed.length + tail.length;
  const out = new Uint8Array(30 + name.length + dataLength + descriptorLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, zip64 ? 45 : 20, true);
  view.setUint16(6, kind ? 8 : 0, true);
  view.setUint16(8, 8, true);
  view.setUint32(14, kind ? 0 : (options.crc ?? crc32(content)), true);
  view.setUint32(18, kind ? 0 : dataLength, true);
  view.setUint32(22, kind ? 0 : content.length, true);
  view.setUint16(26, name.length, true);
  out.set(name, 30);
  const dataStart = 30 + name.length;
  out.set(compressed, dataStart);
  out.set(tail, dataStart + compressed.length);
  if (kind) {
    let at = dataStart + dataLength;
    if (signed) {
      view.setUint32(at, 0x08074b50, true);
      at += 4;
    }
    view.setUint32(at, options.crc ?? crc32(content), true);
    if (zip64) {
      view.setBigUint64(at + 4, BigInt(dataLength), true);
      view.setBigUint64(at + 12, BigInt(content.length), true);
    } else {
      view.setUint32(at + 4, dataLength, true);
      view.setUint32(at + 8, content.length, true);
    }
  }
  return options.cut ? out.slice(0, -options.cut) : out;
}

// Deliver all decoded bytes, then emulate engines that reject bytes after the
// deflate end marker. This keeps the result independent of the local Node version.
function rejectAfterOutput(force = false): void {
  vi.stubGlobal('DecompressionStream', class extends TransformStream<Uint8Array, Uint8Array> {
    constructor(_format: string) {
      const input: Uint8Array[] = [];
      super({
        transform(chunk) { input.push(chunk); },
        async flush(controller) {
          const data = new Blob(input as BlobPart[]);
          const reader = data.stream().pipeThrough(new nativeDecompressionStream('deflate-raw')).getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch {
            // The production reader receives the same partial output and error.
          }
          const length = input.reduce((total, chunk) => total + chunk.length, 0);
          if (force || length > new Uint8Array(deflateRawSync(payload)).length) {
            throw new TypeError('stream rejected trailing data');
          }
        },
      });
    }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('descriptor recovery', () => {
  it.each<Descriptor>(['signed32', 'unsigned32', 'signed64', 'unsigned64'])(
    'removes a %s descriptor and verifies its CRC', async (descriptor) => {
      const zip = record({ descriptor });
      const [entry] = scanLocalHeaders(zip);
      expect(entry.descriptorValidated).toBe(true);
      expect(entry.dataEnd - entry.dataStart).toBe(new Uint8Array(deflateRawSync(payload)).length);
      expect(entry.truncated).toBe(false);
      const result = await recoverZip(zip);
      expect(result.source).toBe('scan');
      expect(result.entries[0]).toMatchObject({ status: 'ok', expectedSize: null });
      expect(result.entries[0].bytes).toEqual(payload);
    }
  );

  it('selects the CRC-valid unsigned ZIP64 candidate when a 32-bit size also fits', async () => {
    const content = encode('a'.repeat(13));
    const compressed = new Uint8Array(deflateRawSync(content));
    expect(compressed.length).toBe(5);
    const zip = record({ descriptor: 'unsigned64', content });
    const [entry] = scanLocalHeaders(zip);
    expect(entry.descriptorValidated).toBe(false);
    const candidates = trailingDescriptors(zip, entry.dataStart, nextRecordBoundary(zip, entry.dataStart));
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ crc: 0, compressedSize: 13 });
    expect(candidates[1]).toMatchObject({ crc: crc32(content), compressedSize: 5 });
    const result = await recoverZip(zip);
    expect(result.entries[0]).toMatchObject({ status: 'ok', size: 13 });
    expect(result.entries[0].bytes).toEqual(content);
  });

  it('recovers an unambiguous unsigned ZIP64 descriptor', async () => {
    const content = encode('short ZIP64 content');
    const zip = record({ descriptor: 'unsigned64', content });
    const result = await recoverZip(zip);
    expect(result.entries[0]).toMatchObject({ status: 'ok', size: content.length });
    expect(result.entries[0].bytes).toEqual(content);
  });

  it('accepts complete output after a stream exception when the descriptor CRC matches', async () => {
    rejectAfterOutput(true);
    const result = await recoverZip(record({ descriptor: 'unsigned32' }));
    expect(result.entries[0]).toMatchObject({ status: 'ok', size: payload.length });
    expect(result.entries[0].bytes).toEqual(payload);
  });

  it('accepts complete output despite extra deflate bytes when the header CRC matches', async () => {
    rejectAfterOutput();
    const result = await recoverZip(record({ trailing: new Uint8Array([0xff, 0xee]) }));
    expect(result.entries[0]).toMatchObject({ status: 'ok', size: payload.length });
    expect(result.entries[0].bytes).toEqual(payload);
  });

  it('keeps an incomplete deflate stream truncated', async () => {
    const result = await recoverZip(record({ cut: 2 }));
    expect(result.entries[0]).toMatchObject({ status: 'broken', reason: 'truncated' });
  });

  it('falls back to unknown CRC when no descriptor candidate matches', async () => {
    rejectAfterOutput(true);
    const result = await recoverZip(record({ descriptor: 'signed32', crc: 1 }));
    expect(result.entries[0]).toMatchObject({ status: 'broken', reason: 'truncated', size: payload.length });
  });

  it('does not trust a descriptor whose compressed size misses the data boundary', async () => {
    const zip = record({ descriptor: 'unsigned32' });
    const at = zip.length - 8;
    new DataView(zip.buffer).setUint32(at, 1, true);
    expect(scanLocalHeaders(zip)[0].descriptorValidated).toBe(false);
  });

  it('keeps an exception with unknown CRC classified as truncated', async () => {
    rejectAfterOutput();
    const zip = record({ descriptor: 'unsigned32', trailing: new Uint8Array([0xff]), cut: 12 });
    const result = await recoverZip(zip);
    expect(result.entries[0]).toMatchObject({ status: 'broken', reason: 'truncated' });
  });
});
