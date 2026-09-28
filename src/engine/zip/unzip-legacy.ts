/**
 * Read and extract a .zip in the browser, without a server (@zip.js/zip.js).
 *
 * Listing reads only the archive's central directory (the small index every ZIP
 * keeps at the end), so it is fast even for large archives and works on encrypted
 * archives (the index itself is usually not encrypted — only the entry data is).
 * Extraction decompresses one entry at a time into a Blob on demand.
 *
 * Honesty (TOOL-ADAPTATION-PLAYBOOK §B): garbled (non-UTF-8) names are surfaced
 * as such rather than pretending they are fine; encrypted entries are marked
 * locked and are not decrypted here; a malformed archive throws a clear error
 * instead of crashing.
 */

import { ZipReader, BlobReader, BlobWriter, type FileEntry } from '@zip.js/zip.js';

export interface ZipEntry {
  /** Full path within the archive, e.g. "docs/notes.txt". */
  name: string;
  directory: boolean;
  /** Uncompressed size in bytes. */
  size: number;
  compressedSize: number;
  date?: Date;
  encrypted: boolean;
  /** false ⇒ the name was NOT stored as UTF-8 and may be mojibake. */
  utf8: boolean;
}

/** The last path segment of an entry name (its file name without folders). */
export function baseName(name: string): string {
  const trimmed = name.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** True when a name was not stored as UTF-8 and holds bytes that may be mojibake. */
export function isGarbled(entry: ZipEntry): boolean {
  return !entry.utf8 && /[\u0080-\uffff]/.test(entry.name);
}

/**
 * List every entry in the archive. Reads only the central directory.
 * Throws if the file is not a readable ZIP.
 */
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
 * Extract a single entry (by its full name) to a Blob. Opens a fresh reader so
 * no reader is held open across the UI's lifetime. Throws if the name is not
 * found, is a directory, or is encrypted (decryption is out of scope — a future
 * unlock-zip tool handles password-protected archives).
 */
export async function extractEntry(file: File, name: string): Promise<Blob> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const entry = entries.find((e) => e.filename === name);
    if (!entry) throw new Error(`Entry not found: ${name}`);
    if (entry.directory) throw new Error(`Entry is a directory: ${name}`);
    if (entry.encrypted) throw new Error(`Entry is encrypted: ${name}`);
    return await entry.getData(new BlobWriter());
  } finally {
    await reader.close();
  }
}

export interface ExtractedFile {
  name: string;
  blob: Blob;
}

/**
 * Extract every non-directory, non-encrypted entry to a Blob in one pass
 * (opens the reader once). Encrypted entries are skipped — they cannot be
 * decrypted here. `onProgress` reports the 1-based index as each file finishes.
 */
export async function extractAll(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedFile[]> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const files = entries.filter(
      (e): e is FileEntry => !e.directory && !e.encrypted,
    );
    const out: ExtractedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      const blob = await entry.getData(new BlobWriter());
      out.push({ name: entry.filename, blob });
      onProgress?.(i + 1, files.length);
    }
    return out;
  } finally {
    await reader.close();
  }
}

