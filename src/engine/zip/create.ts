/**
 * Create a .zip from files, entirely in the browser (@zip.js/zip.js, no server).
 *
 * Windows-safe filenames: `useUnicodeFileNames` (default, kept explicit) sets the
 * UTF-8 "language encoding" flag (general-purpose bit 11) on every entry, so non-ASCII
 * names (Japanese, etc.) extract correctly in Windows Explorer instead of mojibake.
 */

import { ZipWriter, BlobWriter, BlobReader } from '@zip.js/zip.js';
import { EngineError } from '../errors';

export interface CreateProgress {
  index: number; // 0-based
  total: number;
  name: string;
}

export interface CreateOptions {
  password?: string;
  onProgress?: (progress: CreateProgress) => void;
}

/** Folder uploads expose a relative path; otherwise just the file name. */
function entryName(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

/** Disambiguate duplicate entry names: "a.txt", "a (1).txt", "a (2).txt". */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

export async function createZip(
  files: File[],
  options: CreateOptions = {},
): Promise<Blob> {
  if (files.length === 0) throw new EngineError('unsupported', 'No files to archive');
  if (options.password === '') throw new EngineError('unsupported', 'Password cannot be empty');

  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    useUnicodeFileNames: true, // UTF-8 (bit 11) — correct names on Windows
    ...(options.password === undefined ? {} : { password: options.password, encryptionStrength: 3 as const }),
  });

  const used = new Set<string>();
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      options.onProgress?.({ index: i, total: files.length, name: file.name });
      await writer.add(uniqueName(entryName(file), used), new BlobReader(file));
    }
    return await writer.close();
  } catch (error) {
    await writer.close().catch(() => {});
    throw error;
  }
}
