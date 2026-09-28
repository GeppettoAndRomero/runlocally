import { BlobReader, BlobWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import type { ExtractedFile } from '../types';
import { EngineError } from '../errors';
import { readCentralEntries } from './list';

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
    return await entry.getData(new BlobWriter());
  } finally {
    await reader.close();
  }
}

/** Extract supported files in archive order, reporting completed files. */
export async function extractAll(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedFile[]> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await readCentralEntries(reader);
    const files = entries.filter(
      (entry): entry is FileEntry => !entry.directory && !entry.encrypted,
    );
    const out: ExtractedFile[] = [];
    for (const entry of files) {
      const blob = await entry.getData(new BlobWriter());
      out.push({ name: entry.filename, blob });
      onProgress?.(out.length, files.length);
    }
    return out;
  } finally {
    await reader.close();
  }
}
