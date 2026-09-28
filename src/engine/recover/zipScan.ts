/**
 * Local-file-header scanner — the salvage layer.
 *
 * When a ZIP's central directory (the index at the end of the file) is missing
 * or damaged, the normal reader gives up. But every file inside a ZIP is also
 * preceded by its own *local file header* (signature `PK\x03\x04`). This module
 * scans the raw bytes for those headers and reconstructs an entry list directly
 * from them, so files can be salvaged even when the index is unreadable.
 *
 * It is pure and synchronous (no DOM, no decompression) so it is fully unit
 * testable. Decompression of the located data is done separately in
 * `recoverEngine.ts` with the browser-native DecompressionStream.
 *
 * ZIP local file header layout (all integers little-endian):
 *   0  signature            4  (0x04034b50 = PK\x03\x04)
 *   4  version needed       2
 *   6  general purpose flag 2  (bit 3 = sizes/CRC live in a trailing descriptor)
 *   8  compression method   2  (0 = stored, 8 = deflate)
 *  10  last mod time        2
 *  12  last mod date        2
 *  14  CRC-32               4
 *  18  compressed size      4
 *  22  uncompressed size    4
 *  26  file name length (n) 2
 *  28  extra field length(m)2
 *  30  file name            n
 *  30+n extra field         m
 *  30+n+m file data         (compressed size bytes)
 */

/** 30-byte fixed portion of a local file header. */
const LFH_MIN = 30;

// PK signature third/fourth bytes, read big-endian as (byte2 << 8) | byte3.
const SIG_LFH = 0x0304; // local file header      PK\x03\x04
const SIG_CDH = 0x0102; // central directory      PK\x01\x02
const SIG_EOCD = 0x0506; // end of central dir    PK\x05\x06
const SIG_DD = 0x0708; // data descriptor         PK\x07\x08

export interface ScannedEntry {
  /** Byte offset of this entry's local file header. */
  offset: number;
  name: string;
  /** True when the name ends with '/', i.e. a directory placeholder. */
  directory: boolean;
  /** Compression method: 0 = stored, 8 = deflate, other = unsupported here. */
  method: number;
  /** General-purpose bit flag. */
  flag: number;
  /** CRC-32 from the header (0 when carried in a trailing data descriptor). */
  crc: number;
  /** Compressed size from the header (0 when unknown / in a data descriptor). */
  compressedSize: number;
  /** Uncompressed size from the header (0 when unknown / in a data descriptor). */
  uncompressedSize: number;
  /** True when the header sizes/CRC are zero and carried in a data descriptor. */
  hasDataDescriptor: boolean;
  /** Start offset (inclusive) of this entry's compressed data. */
  dataStart: number;
  /** End offset (exclusive) of this entry's compressed data. */
  dataEnd: number;
  /** True when the data runs to end-of-buffer and may be cut short. */
  truncated: boolean;
  /** True when the name was stored as UTF-8 (flag bit 11). */
  utf8: boolean;
}

/** Read the two-byte PK record discriminator at `i`, or -1 if not a PK sig. */
function pkKind(bytes: Uint8Array, i: number): number {
  if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b) return -1;
  return (bytes[i + 2] << 8) | bytes[i + 3];
}

const nameDecoder = new TextDecoder('utf-8'); // non-fatal: mojibake is surfaced, not thrown

/**
 * Scan `bytes` for local file headers and return one entry per plausible header.
 *
 * A candidate header is rejected when its declared name length would run past
 * the end of the buffer, when the name contains a NUL byte, or when the
 * compression method is implausible — cheap filters that reject the stray
 * `PK\x03\x04` byte sequences that can occur inside compressed data.
 */
export function scanLocalHeaders(bytes: Uint8Array): ScannedEntry[] {
  const len = bytes.length;
  if (len < LFH_MIN) return [];

  // Single pass: record every PK signature offset (all record types) so each
  // entry can find the next record boundary, and collect the LFH candidates.
  const sigOffsets: number[] = [];
  const lfhOffsets: number[] = [];
  for (let i = 0; i + 4 <= len; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b) continue;
    const kind = (bytes[i + 2] << 8) | bytes[i + 3];
    if (kind === SIG_LFH || kind === SIG_CDH || kind === SIG_EOCD || kind === SIG_DD) {
      sigOffsets.push(i);
      if (kind === SIG_LFH) lfhOffsets.push(i);
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ScannedEntry[] = [];

  for (const offset of lfhOffsets) {
    if (offset + LFH_MIN > len) continue;

    const flag = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    // Reject implausible candidates (likely a signature inside compressed data).
    if (nameLen < 1 || nameLen > 4096) continue;
    if (offset + LFH_MIN + nameLen > len) continue;
    if (!(method <= 20 || (method >= 93 && method <= 99))) continue;

    const nameBytes = bytes.subarray(offset + LFH_MIN, offset + LFH_MIN + nameLen);
    if (nameBytes.includes(0x00)) continue;
    const name = nameDecoder.decode(nameBytes);

    const dataStart = Math.min(offset + LFH_MIN + nameLen + extraLen, len);
    const hasDataDescriptor = (flag & 0x08) !== 0;

    // Trust the header's compressed size only when it is present and fits;
    // otherwise scavenge to the next PK record boundary (classic recovery).
    let dataEnd: number;
    const sizeTrustable =
      !hasDataDescriptor && compressedSize > 0 && dataStart + compressedSize <= len;
    if (sizeTrustable) {
      dataEnd = dataStart + compressedSize;
    } else {
      dataEnd = len;
      for (const s of sigOffsets) {
        if (s > dataStart) {
          dataEnd = s;
          break;
        }
      }
    }

    entries.push({
      offset,
      name,
      directory: name.endsWith('/'),
      method,
      flag,
      crc,
      compressedSize,
      uncompressedSize,
      hasDataDescriptor,
      dataStart,
      dataEnd,
      truncated: dataEnd >= len && !sizeTrustable,
      utf8: (flag & 0x0800) !== 0,
    });
  }

  return entries;
}

/** Whether a PK signature sits at `i` in `bytes` (any of the four record types). */
export function isPkSignature(bytes: Uint8Array, i: number): boolean {
  const k = pkKind(bytes, i);
  return k === SIG_LFH || k === SIG_CDH || k === SIG_EOCD || k === SIG_DD;
}
