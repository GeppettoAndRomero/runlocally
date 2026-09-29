import { BlobReader, BlobWriter, ZipReader, ERR_INVALID_CRC32, type FileEntry } from '@zip.js/zip.js';
import type { ExtractedFile } from '../types';
import { EngineError } from '../errors';
import { readCentralEntries } from './list';

async function readEntry(entry: FileEntry): Promise<Blob> {
  try {
    return await entry.getData(new BlobWriter(), { checkSignature: true });
  } catch (error) {
    if (error instanceof Error && error.message === ERR_INVALID_CRC32) {
      throw new EngineError('corrupt-entry', error.message, { cause: error });
    }
    throw error;
  }
}

/** Extract the first entry whose full path matches the requested name. */
export async function extractEntry(file: File, name: string): Promise<Blob> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await readCentralEntries(reader);
    const entry = entries.find((candidate) => candidate.filename === name);
    if (!entry || entry.directory) {
      throw new EngineError('unsupported', `Entry is missing or is a directory: ${name}`);
    }
    if (entry.encrypted) {
      throw new EngineError('encrypted-entry', `Entry is encrypted: ${name}`);
    }
    return await readEntry(entry);
  } finally {
    await reader.close();
  }
}

/** Extract supported files in archive order, reporting completed files. */
export async function extractAll(
  file: File,
  onProgress?: (done: number, total: number) => unknown,
): Promise<ExtractedFile[]> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await readCentralEntries(reader);
    const files = entries.filter(
      (entry): entry is FileEntry => !entry.directory && !entry.encrypted,
    );
    const out: ExtractedFile[] = [];
    for (const entry of files) {
      const blob = await readEntry(entry);
      out.push({ name: entry.filename, blob });
      await onProgress?.(out.length, files.length);
    }
    return out;
  } finally {
    await reader.close();
  }
}
