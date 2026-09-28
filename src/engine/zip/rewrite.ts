import {
  BlobReader, BlobWriter, ZipReader, ZipWriter,
  ERR_ENCRYPTED, ERR_INVALID_PASSWORD, ERR_INVALID_AUTHENTICATION_CODE, ERR_INVALID_CRC32,
  ERR_INVALID_COMPRESSED_DATA, ERR_INVALID_UNCOMPRESSED_SIZE,
} from '@zip.js/zip.js';
import type { ZipEntry } from '../types';
import { EngineError } from '../errors';
import { readCentralEntries } from './list';

export interface RewriteEntry extends ZipEntry {
  rawFilename?: Uint8Array;
}

export interface RewriteProgress {
  index: number;
  total: number;
  name: string;
}

export interface RewriteOptions {
  keep?: (name: string) => boolean;
  rename?: (name: string, entry: RewriteEntry) => string;
  password?: string;
  outPassword?: string;
  onProgress?: (progress: RewriteProgress) => void;
}

export interface RewriteResult {
  blob: Blob;
  total: number;
  kept: number;
  removed: number;
  renamed: number;
  encryptedCount: number;
}

/**
 * Rebuild a ZIP in source order, preserving extracted data, explicit directories,
 * and timestamps. `keep` sees original names; `rename` sees only kept entries.
 * Progress is reported before each source entry, including removed entries.
 * Input and output passwords are independent. Counts include directories.
 * A failed rewrite discards its partial output and preserves the first error.
 */
export async function rewriteZip(file: File, options: RewriteOptions = {}): Promise<RewriteResult> {
  if (options.outPassword !== undefined && options.outPassword.length === 0) {
    throw new EngineError('unsupported', 'Output password must not be empty');
  }

  const reader = new ZipReader(new BlobReader(file));
  let failed = false;
  try {
    const entries = await readCentralEntries(reader);
    const total = entries.length;
    const encryptedCount = entries.filter((entry) => entry.encrypted).length;
    if (options.password !== undefined && encryptedCount === 0) {
      throw new EngineError('not-encrypted');
    }

    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      useUnicodeFileNames: true,
      ...(options.outPassword === undefined ? {} : {
        password: options.outPassword,
        encryptionStrength: 3,
      }),
    });
    let kept = 0;
    let removed = 0;
    let renamed = 0;
    try {
      for (let index = 0; index < total; index++) {
        const entry = entries[index];
        const name = entry.filename;
        options.onProgress?.({ index, total, name });
        if (options.keep && !options.keep(name)) {
          removed++;
          continue;
        }
        if (entry.encrypted && options.password === undefined) {
          throw new EngineError('encrypted-entry', `Entry is encrypted: ${name}`);
        }

        const metadata: RewriteEntry = {
          name,
          directory: entry.directory,
          size: entry.uncompressedSize,
          compressedSize: entry.compressedSize,
          date: entry.lastModDate,
          encrypted: entry.encrypted,
          utf8: entry.filenameUTF8,
          rawFilename: entry.rawFilename,
        };
        const outputName = options.rename?.(name, metadata) ?? name;
        if (outputName !== name) renamed++;
        if (entry.directory) {
          await writer.add(outputName, undefined, {
            directory: true,
            lastModDate: entry.lastModDate,
          });
        } else {
          let data: Blob;
          try {
            data = await entry.getData(
              new BlobWriter(),
              entry.encrypted ? { password: options.password, checkCrc32: true } : undefined,
            );
          } catch (error) {
            if (entry.encrypted && error instanceof Error &&
              (error.message === ERR_INVALID_PASSWORD || error.message === ERR_ENCRYPTED ||
                error.message === ERR_INVALID_AUTHENTICATION_CODE ||
                (entry.zipCrypto && (error.message === ERR_INVALID_CRC32 ||
                  error.message === ERR_INVALID_COMPRESSED_DATA ||
                  error.message === ERR_INVALID_UNCOMPRESSED_SIZE)))) {
              throw new EngineError('wrong-password', error.message, { cause: error });
            }
            throw error;
          }
          await writer.add(outputName, new BlobReader(data), { lastModDate: entry.lastModDate });
        }
        kept++;
      }
      const blob = await writer.close();
      return { blob, total, kept, removed, renamed, encryptedCount };
    } catch (error) {
      try { await writer.close(); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await reader.close().catch((error: unknown) => {
      if (!failed) throw error;
    });
  }
}
