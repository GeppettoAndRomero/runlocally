/**
 * recover-zip engine — salvage readable files from a damaged .zip, in the browser.
 *
 * Honest positioning: this recovers the files a
 * ZIP still holds in a readable form. It is not a "repair" that rebuilds a broken
 * archive, and it cannot recover bytes that are physically gone. What it can do:
 *
 *   Layer 1 — the normal path. Read the central directory with @zip.js/zip.js and
 *   list every entry. Decode each one; entries that decode cleanly are OK, entries
 *   that fail (bad CRC, truncated, unsupported) are marked BROKEN but still offered
 *   for download with whatever bytes were salvaged from their local header.
 *
 *   Layer 2 — the recovery path, used when the central directory itself is
 *   unreadable. Scan the raw bytes for local file headers (`scanLocalHeaders`) and
 *   rebuild the entry list from them, inflating DEFLATE with the browser-native
 *   DecompressionStream and copying STORED data as-is.
 *
 * Everything runs on the device: no upload, no server, no extra WebAssembly.
 */

import { ZipReader, BlobReader, Uint8ArrayWriter, configure } from '@zip.js/zip.js';
import { scanLocalHeaders, type ScannedEntry } from './zipScan';
import { crc32 } from './crc32';

// Decode on the main thread: deterministic, works offline (no worker chunk to
// cache), and the salvage path uses the native DecompressionStream anyway.
configure({ useWebWorkers: false });

export type EntryStatus = 'ok' | 'broken';
export type RecoverSource = 'central' | 'scan';

/** Why an entry is broken — mapped to a localized note in the UI. */
export type BrokenReason =
  | 'crc'
  | 'truncated'
  | 'inflate'
  | 'unsupported'
  | 'encrypted'
  | 'empty';

export interface RecoveredEntry {
  name: string;
  directory: boolean;
  status: EntryStatus;
  /** Recovered bytes (possibly partial when broken); null when nothing decodable. */
  bytes: Uint8Array | null;
  /** Length of the recovered bytes. */
  size: number;
  /** Expected uncompressed size from the archive metadata, when known. */
  expectedSize: number | null;
  /** How the entry was located. */
  via: RecoverSource;
  /** Present when status is 'broken'. */
  reason?: BrokenReason;
}

export interface RecoverResult {
  /** Where the entry list came from: the central directory, or a raw-header scan. */
  source: RecoverSource;
  entries: RecoveredEntry[];
  /** Number of file (non-directory) entries. */
  total: number;
  /** Number of file entries recovered intact. */
  recovered: number;
}

interface Decoded {
  status: EntryStatus;
  bytes: Uint8Array | null;
  reason?: BrokenReason;
}

/** Join decoded chunks into a single Uint8Array. */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Inflate raw DEFLATE, keeping partial output when the stream is truncated or
 * corrupt. `complete` is false when decoding stopped early on an error.
 */
async function inflateRawPartial(
  data: Uint8Array
): Promise<{ bytes: Uint8Array; complete: boolean }> {
  const ds = new DecompressionStream('deflate-raw');
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(ds).getReader();
  const chunks: Uint8Array[] = [];
  let complete = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch {
    // Corrupt/truncated DEFLATE: keep whatever decoded before the error.
    complete = false;
    try {
      await reader.cancel();
    } catch {
      /* already errored */
    }
  }
  return { bytes: concatChunks(chunks), complete };
}

/** Decode a single scanned entry's data into recovered bytes + a status. */
async function decodeScanned(bytes: Uint8Array, s: ScannedEntry): Promise<Decoded> {
  const data = bytes.subarray(s.dataStart, s.dataEnd);
  const crcKnown = !s.hasDataDescriptor && s.crc !== 0;

  if (data.length === 0) {
    return { status: 'broken', bytes: null, reason: s.truncated ? 'truncated' : 'empty' };
  }

  // STORED — bytes are the content verbatim.
  if (s.method === 0) {
    const out = data.slice();
    if (s.truncated) return { status: 'broken', bytes: out, reason: 'truncated' };
    if (crcKnown && crc32(out) !== s.crc) return { status: 'broken', bytes: out, reason: 'crc' };
    return { status: 'ok', bytes: out };
  }

  // DEFLATE — inflate with the native stream, tolerating truncation.
  if (s.method === 8) {
    const { bytes: out, complete } = await inflateRawPartial(data);
    if (out.length === 0) {
      return { status: 'broken', bytes: null, reason: complete ? 'inflate' : 'truncated' };
    }
    if (!complete) return { status: 'broken', bytes: out, reason: 'truncated' };
    if (crcKnown && crc32(out) !== s.crc) return { status: 'broken', bytes: out, reason: 'crc' };
    return { status: 'ok', bytes: out };
  }

  // Any other method (bzip2, lzma, zstd, …) is not decodable here.
  return { status: 'broken', bytes: null, reason: 'unsupported' };
}

/** Salvage bytes for a named entry by decoding its scanned local header. */
async function salvage(bytes: Uint8Array, s: ScannedEntry | undefined): Promise<Decoded> {
  if (!s) return { status: 'broken', bytes: null, reason: 'inflate' };
  return decodeScanned(bytes, s);
}

/** Layer 1: read the central directory and decode each entry. */
async function recoverFromCentral(
  bytes: Uint8Array,
  scanned: ScannedEntry[]
): Promise<RecoverResult | null> {
  const reader = new ZipReader(new BlobReader(new Blob([bytes as BlobPart])));
  let metas;
  try {
    metas = await reader.getEntries();
  } catch {
    await reader.close().catch(() => {});
    return null; // central directory unreadable → fall through to the scan layer
  }

  // First occurrence wins when names repeat (rare); good enough for salvage.
  const byName = new Map<string, ScannedEntry>();
  for (const s of scanned) if (!byName.has(s.name)) byName.set(s.name, s);

  const entries: RecoveredEntry[] = [];
  try {
    for (const m of metas) {
      const expectedSize = m.uncompressedSize ?? null;
      if (m.directory) {
        entries.push({
          name: m.filename,
          directory: true,
          status: 'ok',
          bytes: null,
          size: 0,
          expectedSize: 0,
          via: 'central',
        });
        continue;
      }
      if (m.encrypted) {
        entries.push({
          name: m.filename,
          directory: false,
          status: 'broken',
          bytes: null,
          size: 0,
          expectedSize,
          via: 'central',
          reason: 'encrypted',
        });
        continue;
      }
      try {
        // checkSignature verifies the CRC-32 — without it, zip.js returns
        // corrupted bytes as if they were fine.
        const data = await m.getData!(new Uint8ArrayWriter(), { checkSignature: true });
        entries.push({
          name: m.filename,
          directory: false,
          status: 'ok',
          bytes: data,
          size: data.length,
          expectedSize,
          via: 'central',
        });
      } catch {
        // Listed but undecodable: salvage raw bytes from its local header.
        const salv = await salvage(bytes, byName.get(m.filename));
        entries.push({
          name: m.filename,
          directory: false,
          status: 'broken',
          bytes: salv.bytes,
          size: salv.bytes?.length ?? 0,
          expectedSize,
          via: 'central',
          reason: salv.reason ?? 'crc',
        });
      }
    }
  } finally {
    await reader.close().catch(() => {});
  }

  return summarize('central', entries);
}

/** Layer 2: rebuild the entry list from scanned local headers. */
async function recoverFromScan(bytes: Uint8Array, scanned: ScannedEntry[]): Promise<RecoverResult> {
  const entries: RecoveredEntry[] = [];
  for (const s of scanned) {
    const expectedSize = s.uncompressedSize || null;
    if (s.directory) {
      entries.push({
        name: s.name,
        directory: true,
        status: 'ok',
        bytes: null,
        size: 0,
        expectedSize: 0,
        via: 'scan',
      });
      continue;
    }
    const dec = await decodeScanned(bytes, s);
    entries.push({
      name: s.name,
      directory: false,
      status: dec.status,
      bytes: dec.bytes,
      size: dec.bytes?.length ?? 0,
      expectedSize,
      via: 'scan',
      reason: dec.reason,
    });
  }
  return summarize('scan', entries);
}

function summarize(source: RecoverSource, entries: RecoveredEntry[]): RecoverResult {
  const files = entries.filter((e) => !e.directory);
  return {
    source,
    entries,
    total: files.length,
    recovered: files.filter((e) => e.status === 'ok').length,
  };
}

/**
 * Recover the files from a (possibly damaged) ZIP. Tries the central directory
 * first; falls back to a raw local-header scan when that index is unreadable.
 */
export async function recoverZip(input: ArrayBuffer | Uint8Array): Promise<RecoverResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const scanned = scanLocalHeaders(bytes);

  const central = await recoverFromCentral(bytes, scanned);
  if (central && central.entries.length > 0) return central;

  return recoverFromScan(bytes, scanned);
}

/** Last path segment of an entry name, safe to use as a download filename. */
export function baseName(name: string): string {
  const trimmed = name.replace(/\/+$/, '');
  const seg = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return seg || 'recovered-file';
}
