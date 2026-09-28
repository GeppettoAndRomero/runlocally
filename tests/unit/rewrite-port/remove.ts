import { ZipReader, ZipWriter, BlobReader, BlobWriter } from '@zip.js/zip.js';

export interface ZipEntry {
  name: string;
  directory: boolean;
  size: number; // uncompressed
  compressedSize: number;
  date?: Date;
  encrypted: boolean;
  /** false ⇒ name was NOT stored as UTF-8: may be mojibake on the wrong locale. */
  utf8: boolean;
}

export interface TrimProgress {
  index: number; // 0-based
  total: number;
  name: string;
}

export interface TrimResult {
  blob: Blob;
  kept: number;
  removed: number;
}

/** Thrown when a kept entry is encrypted and cannot be re-packed. */
export class EncryptedEntryError extends Error {
  constructor() {
    super('encrypted-entry');
    this.name = 'EncryptedEntryError';
  }
}

/** List the entries of a .zip without extracting (reads the central directory). */
export async function listZip(file: File): Promise<ZipEntry[]> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    return entries.map((e) => ({
      name: e.filename,
      directory: e.directory,
      size: e.uncompressedSize,
      compressedSize: e.compressedSize,
      date: e.lastModDate,
      encrypted: e.encrypted,
      utf8: e.filenameUTF8,
    }));
  } finally {
    await reader.close();
  }
}

/**
 * Build a new .zip containing only the entries whose name `keep()` returns true.
 * The source archive is read, each kept entry is copied across (its data streamed
 * through a BlobWriter), and the rest are dropped.
 */
export async function buildTrimmedZip(
  file: File,
  keep: (name: string) => boolean,
  onProgress?: (p: TrimProgress) => void
): Promise<TrimResult> {
  const reader = new ZipReader(new BlobReader(file));
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    useUnicodeFileNames: true, // UTF-8 (bit 11) — correct names on Windows
  });

  let kept = 0;
  let removed = 0;
  try {
    const entries = await reader.getEntries();
    const total = entries.length;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      onProgress?.({ index: i, total, name: entry.filename });
      if (!keep(entry.filename)) {
        removed += 1;
        continue;
      }
      kept += 1;
      if (entry.directory) {
        await writer.add(entry.filename, undefined, {
          directory: true,
          lastModDate: entry.lastModDate,
        });
      } else {
        if (entry.encrypted) throw new EncryptedEntryError();
        const data = await entry.getData(new BlobWriter());
        await writer.add(entry.filename, new BlobReader(data), {
          lastModDate: entry.lastModDate,
        });
      }
    }
  } finally {
    await reader.close();
  }

  const blob = await writer.close();
  return { blob, kept, removed };
}
