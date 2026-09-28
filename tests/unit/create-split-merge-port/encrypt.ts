/**
 * Create a password-protected .zip entirely in the browser (@zip.js/zip.js, no server).
 *
 * Every entry is encrypted with WinZip AES; `encryptionStrength: 3` selects a
 * 256-bit key (AES-256). The password never leaves the device — the archive is
 * built locally from a Blob and downloaded straight to disk.
 *
 * Windows-safe filenames: `useUnicodeFileNames` (default, kept explicit) sets the
 * UTF-8 "language encoding" flag (general-purpose bit 11) on every entry, so
 * non-ASCII names (Japanese, etc.) extract correctly instead of turning into
 * mojibake (garbled text).
 */

import { ZipWriter, BlobWriter, BlobReader } from '@zip.js/zip.js';

/** AES key strength for @zip.js/zip.js: 1 = AES-128, 2 = AES-192, 3 = AES-256. */
export const AES_256: 1 | 2 | 3 = 3;

export interface ZipProgress {
  index: number; // 0-based
  total: number;
  name: string;
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

/**
 * Build an AES-256 password-protected zip from the given files.
 *
 * @throws if there are no files, or if the password is empty (an empty password
 * would produce an archive that is not actually protected).
 */
export async function createEncryptedZip(
  files: File[],
  password: string,
  onProgress?: (p: ZipProgress) => void
): Promise<Blob> {
  if (files.length === 0) throw new Error('No files to archive');
  if (password.length === 0) throw new Error('A password is required');

  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    password,
    encryptionStrength: AES_256, // WinZip AES-256
    useUnicodeFileNames: true, // UTF-8 (bit 11) — correct names on Windows
  });

  const used = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({ index: i, total: files.length, name: file.name });
    await writer.add(uniqueName(entryName(file), used), new BlobReader(file));
  }
  return writer.close();
}
