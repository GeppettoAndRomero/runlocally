import {
  ZipReader,
  ZipWriter,
  BlobReader,
  BlobWriter,
  ERR_INVALID_PASSWORD,
  ERR_ENCRYPTED,
} from '@zip.js/zip.js';

/** Thrown when the supplied password does not decrypt the archive. */
export class WrongPasswordError extends Error {
  constructor() {
    super('WRONG_PASSWORD');
    this.name = 'WrongPasswordError';
  }
}

/** Thrown when the archive has no encrypted entries (nothing to unlock). */
export class NotEncryptedError extends Error {
  constructor() {
    super('NOT_ENCRYPTED');
    this.name = 'NotEncryptedError';
  }
}

export interface UnlockProgress {
  index: number; // 0-based
  total: number;
  name: string;
}

export interface UnlockResult {
  /** The unprotected .zip (same contents, no password). */
  blob: Blob;
  /** Number of entries copied (files + directories). */
  entryCount: number;
  /** Number of entries that were encrypted in the input. */
  encryptedCount: number;
}

/** True when a thrown zip.js error means the password was wrong / missing. */
function isWrongPassword(err: unknown): boolean {
  if (err instanceof WrongPasswordError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  // AES verifies via the authentication code; ZipCrypto via the check byte.
  // Both surface as ERR_INVALID_PASSWORD. ERR_ENCRYPTED means an encrypted entry
  // was read without a password (e.g. an empty password) — same user cause.
  return msg === ERR_INVALID_PASSWORD || msg === ERR_ENCRYPTED;
}

/**
 * Read `file` (a .zip you can open with `password`) and return an identical
 * archive with the password removed.
 *
 * @throws {NotEncryptedError} the archive has no encrypted entries.
 * @throws {WrongPasswordError} the password does not decrypt the archive.
 * @throws {Error} the file is not a readable zip archive.
 */
export async function unlockZip(
  file: Blob,
  password: string,
  onProgress?: (p: UnlockProgress) => void
): Promise<UnlockResult> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const encryptedCount = entries.filter((e) => e.encrypted).length;
    if (encryptedCount === 0) {
      throw new NotEncryptedError();
    }

    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      // UTF-8 (general-purpose bit 11) — non-ASCII names extract correctly.
      useUnicodeFileNames: true,
    });

    try {
      const total = entries.length;
      for (let i = 0; i < total; i++) {
        const entry = entries[i];
        onProgress?.({ index: i, total, name: entry.filename });

        if (entry.directory) {
          await writer.add(entry.filename, undefined, {
            directory: true,
            lastModDate: entry.lastModDate,
          });
          continue;
        }

        // getData is only on FileEntry (directory === false, handled above).
        const getData = (entry as unknown as {
          getData: (w: BlobWriter, o?: { password?: string }) => Promise<Blob>;
        }).getData;
        const data = await getData.call(
          entry,
          new BlobWriter(),
          entry.encrypted ? { password } : undefined
        );
        await writer.add(entry.filename, new BlobReader(data), {
          lastModDate: entry.lastModDate,
        });
      }

      const blob = await writer.close();
      return { blob, entryCount: total, encryptedCount };
    } catch (err) {
      // Discard the half-built output; re-classify a wrong password.
      try {
        await writer.close();
      } catch {
        /* already failed — ignore */
      }
      if (isWrongPassword(err)) throw new WrongPasswordError();
      throw err;
    }
  } finally {
    await reader.close();
  }
}
