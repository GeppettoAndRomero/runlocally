/**
 * List the contents of a .zip in the browser, without extracting (@zip.js/zip.js).
 *
 * Only the central directory is read, so listing is fast and works on encrypted
 * archives (the entry list isn't encrypted, only the data). Honesty points
 * (TOOL-ADAPTATION-PLAYBOOK): garbled (non-UTF-8) names are surfaced as such instead
 * of pretending they're fine; encrypted entries are shown locked; a malformed archive
 * throws a clear error rather than crashing.
 */

import { ZipReader, BlobReader } from '@zip.js/zip.js';

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
