import {
  BlobReader,
  ZipReader,
  ERR_BAD_FORMAT,
  ERR_EOCDR_NOT_FOUND,
  ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND,
  ERR_CENTRAL_DIRECTORY_NOT_FOUND,
  ERR_EXTRAFIELD_ZIP64_NOT_FOUND,
  ERR_ENCRYPTED_CENTRAL_DIRECTORY,
} from '@zip.js/zip.js';
import type { ZipEntry } from '../types';
import { EngineError } from '../errors';

const centralErrors = new Set([
  ERR_BAD_FORMAT,
  ERR_EOCDR_NOT_FOUND,
  ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND,
  ERR_CENTRAL_DIRECTORY_NOT_FOUND,
  ERR_EXTRAFIELD_ZIP64_NOT_FOUND,
]);

/** Only known zip.js central-directory failures are reclassified. */
export async function readCentralEntries(reader: ZipReader<BlobReader>) {
  try {
    return await reader.getEntries();
  } catch (error) {
    if (error instanceof Error && centralErrors.has(error.message)) {
      throw new EngineError('bad-central', error.message, { cause: error });
    }
    // An encrypted central directory is a valid archive in a format this engine does not read.
    if (error instanceof Error && error.message === ERR_ENCRYPTED_CENTRAL_DIRECTORY) {
      throw new EngineError('unsupported', error.message, { cause: error });
    }
    throw error;
  }
}

/** List archive metadata without extracting entry data. */
export async function listEntries(file: File): Promise<ZipEntry[]> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await readCentralEntries(reader);
    return entries.map((entry) => ({
      name: entry.filename,
      directory: entry.directory,
      size: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      date: entry.lastModDate,
      encrypted: entry.encrypted,
      utf8: entry.filenameUTF8,
      rawFilename: entry.rawFilename,
    }));
  } finally {
    await reader.close();
  }
}
