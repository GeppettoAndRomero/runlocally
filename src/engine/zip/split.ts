/**
 * Split one .zip into several smaller, independent .zip files — entirely in the
 * browser (@zip.js/zip.js, no server).
 *
 * This does NOT produce a multi-volume / spanned archive (.z01, .z02, …). That
 * format is fragile and poorly supported. Instead each part is a normal, complete
 * .zip that opens on its own; together the parts contain every entry of the input.
 *
 * Sizing honesty (TOOL-ADAPTATION-PLAYBOOK §B): parts are planned by the
 * UNCOMPRESSED size of each entry plus structural overhead. DEFLATE never expands
 * data beyond its input by more than a rounding margin, so a part re-packaged from
 * entries whose uncompressed sizes fit the budget is guaranteed to end up at or
 * below the target — for any input, regardless of how the source was compressed.
 * A well-compressed archive may therefore yield parts smaller than the target.
 * A single entry larger than the target cannot be split without spanning, so it
 * goes into its own part and is flagged as oversize.
 */

import { ZipReader, ZipWriter, BlobReader, BlobWriter } from '@zip.js/zip.js';
import type { ZipEntry } from '../types';
import { EngineError } from '../errors';
import { readCentralEntries } from './list';

/** Per-entry structural overhead: local + central headers, data descriptor, UTF-8 extra. */
const PER_ENTRY_OVERHEAD = 128;
/** Per-part structural overhead: end-of-central-directory record + slack. */
const PER_PART_OVERHEAD = 64;

function nameBytes(name: string): number {
  return new TextEncoder().encode(name).length;
}

/**
 * Bytes an entry adds to a part: its uncompressed data (an upper bound on any
 * DEFLATE output), plus per-entry structural overhead, plus a worst-case margin
 * for DEFLATE stored-block framing on incompressible data.
 */
export function entryPackSize(uncompressedSize: number, name: string): number {
  const headers = PER_ENTRY_OVERHEAD + 2 * nameBytes(name);
  const deflateWorstCase = Math.ceil(uncompressedSize / 32768) * 6 + 8;
  return uncompressedSize + headers + deflateWorstCase;
}

export interface PackEntry {
  name: string;
  /** the entry's contribution to a part, in bytes (see entryPackSize) */
  size: number;
}

export interface PlanPart {
  /** 0-based indices into the entries array assigned to this part */
  indices: number[];
  /** estimated packed size of this part in bytes (upper bound) */
  size: number;
  /** true when this part holds a single entry that alone exceeds the target */
  oversize: boolean;
}

/**
 * Bin-pack entries into parts so each part's estimated size ≤ targetBytes.
 *
 * First-fit-decreasing: deterministic and produces few parts. An entry that alone
 * exceeds the target gets its own part, flagged oversize (a single file cannot be
 * split across parts without producing a fragile spanned archive).
 */
export function planParts(
  entries: PackEntry[],
  targetBytes: number,
  partOverhead: number = PER_PART_OVERHEAD
): PlanPart[] {
  const budget = Math.max(1, targetBytes - partOverhead);
  const order = entries
    .map((e, i) => ({ i, size: e.size }))
    .sort((a, b) => b.size - a.size || a.i - b.i);

  const parts: PlanPart[] = [];
  for (const { i, size } of order) {
    if (size > budget) {
      parts.push({ indices: [i], size: size + partOverhead, oversize: true });
      continue;
    }
    let placed = false;
    for (const p of parts) {
      if (p.oversize) continue;
      if (p.size - partOverhead + size <= budget) {
        p.indices.push(i);
        p.size += size;
        placed = true;
        break;
      }
    }
    if (!placed) parts.push({ indices: [i], size: partOverhead + size, oversize: false });
  }
  // Show entries in ascending original order within each part, and put oversize
  // parts (single big files) last so numbered parts read predictably.
  for (const p of parts) p.indices.sort((a, b) => a - b);
  parts.sort((a, b) => {
    if (a.oversize !== b.oversize) return a.oversize ? 1 : -1;
    return a.indices[0] - b.indices[0];
  });
  return parts;
}

/** Plan how a set of zip entries would be split, without reading their data. */
export function buildPlan(entries: ZipEntry[], targetBytes: number): PlanPart[] {
  const packEntries: PackEntry[] = entries.map((e) => ({
    name: e.name,
    size: e.directory
      ? PER_ENTRY_OVERHEAD + 2 * nameBytes(e.name)
      : entryPackSize(e.size, e.name),
  }));
  return planParts(packEntries, targetBytes);
}

export interface SplitPart {
  /** download filename, e.g. archive-part-01.zip */
  name: string;
  blob: Blob;
  /** actual byte size of the produced part */
  size: number;
  /** number of files (non-directory entries) in this part */
  count: number;
  oversize: boolean;
}

export interface SplitProgress {
  part: number; // 1-based
  totalParts: number;
}

/** Strip a trailing .zip and return a safe base name for the parts. */
export function partBaseName(fileName: string): string {
  return fileName.replace(/\.zip$/i, '').trim() || 'archive';
}

/**
 * Split `file` into independent .zip parts. A single oversized entry gets its own part.
 * Every entry of the input ends up in exactly one part.
 */
export async function splitZip(
  file: File,
  targetBytes: number,
  onProgress?: (p: SplitProgress) => unknown
): Promise<SplitPart[]> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await readCentralEntries(reader);
    if (entries.length === 0) throw new EngineError('unsupported', 'This archive has no entries to split');
    const meta: ZipEntry[] = entries.map((e) => ({
      name: e.filename,
      directory: e.directory,
      size: e.uncompressedSize,
      compressedSize: e.compressedSize,
      date: e.lastModDate,
      encrypted: e.encrypted,
      utf8: e.filenameUTF8,
    }));
    const plan = buildPlan(meta, targetBytes);
    const base = partBaseName(file.name);
    const pad = Math.max(2, String(plan.length).length);
    const parts: SplitPart[] = [];
    for (let p = 0; p < plan.length; p++) {
      await onProgress?.({ part: p + 1, totalParts: plan.length });
      const writer = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
      try {
        let count = 0;
        for (const idx of plan[p].indices) {
          const entry = entries[idx];
          if (entry.directory) {
            await writer.add(entry.filename, undefined, {
              directory: true,
              lastModDate: entry.lastModDate,
            });
          } else {
            if (entry.encrypted) throw new EngineError('encrypted-entry', `Entry is encrypted: ${entry.filename}`);
            const data = await entry.getData(new BlobWriter());
            await writer.add(entry.filename, new BlobReader(data), { lastModDate: entry.lastModDate });
            count++;
          }
        }
        const blob = await writer.close();
        const num = String(p + 1).padStart(pad, '0');
        parts.push({ name: `${base}-part-${num}.zip`, blob, size: blob.size, count, oversize: plan[p].oversize });
      } catch (error) {
        await writer.close().catch(() => {});
        throw error;
      }
    }
    return parts;
  } finally {
    await reader.close().catch(() => {});
  }
}

/** Human-readable byte size, e.g. 1536 → "1.5 KB". */
export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
