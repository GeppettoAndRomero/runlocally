/**
 * A tiny, dependency-free ZIP builder for STORED (uncompressed) entries. Gives
 * unit tests byte-exact control so they can corrupt a specific field (flip a
 * data byte to force a CRC mismatch, truncate the central directory, etc.)
 * without depending on how a real compressor lays bytes out.
 */
import { crc32 } from '@/engine/recover/crc32';

const enc = new TextEncoder();

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

export interface BuildEntry {
  name: string;
  data: Uint8Array | string;
}

/** Build a valid ZIP whose entries are all STORED (method 0). */
export function buildStoredZip(entries: BuildEntry[]): Uint8Array {
  const parts: number[] = [];
  const cd: number[] = [];
  const offsets: number[] = [];

  for (const e of entries) {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const name = enc.encode(e.name);
    const crc = crc32(data);
    const offset = parts.length;
    offsets.push(offset);

    // Local file header.
    parts.push(0x50, 0x4b, 0x03, 0x04);
    parts.push(...u16(20)); // version needed
    parts.push(...u16(0)); // flag
    parts.push(...u16(0)); // method: stored
    parts.push(...u16(0), ...u16(0)); // mod time/date
    parts.push(...u32(crc));
    parts.push(...u32(data.length)); // compressed size
    parts.push(...u32(data.length)); // uncompressed size
    parts.push(...u16(name.length));
    parts.push(...u16(0)); // extra length
    parts.push(...name);
    parts.push(...data);

    // Central directory header (assembled now, appended after all locals).
    cd.push(0x50, 0x4b, 0x01, 0x02);
    cd.push(...u16(20)); // version made by
    cd.push(...u16(20)); // version needed
    cd.push(...u16(0)); // flag
    cd.push(...u16(0)); // method
    cd.push(...u16(0), ...u16(0)); // mod time/date
    cd.push(...u32(crc));
    cd.push(...u32(data.length));
    cd.push(...u32(data.length));
    cd.push(...u16(name.length));
    cd.push(...u16(0)); // extra length
    cd.push(...u16(0)); // comment length
    cd.push(...u16(0)); // disk number start
    cd.push(...u16(0)); // internal attrs
    cd.push(...u32(0)); // external attrs
    cd.push(...u32(offset));
    cd.push(...name);
  }

  const cdOffset = parts.length;
  parts.push(...cd);
  const cdSize = cd.length;

  // End of central directory record.
  parts.push(0x50, 0x4b, 0x05, 0x06);
  parts.push(...u16(0), ...u16(0)); // disk numbers
  parts.push(...u16(entries.length), ...u16(entries.length));
  parts.push(...u32(cdSize));
  parts.push(...u32(cdOffset));
  parts.push(...u16(0)); // comment length

  return new Uint8Array(parts);
}

/** Byte offset of the first central-directory record (PK\x01\x02), or -1. */
export function centralDirStart(bytes: Uint8Array): number {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      return i;
    }
  }
  return -1;
}
