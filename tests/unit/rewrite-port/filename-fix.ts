import {
  ZipReader,
  ZipWriter,
  BlobReader,
  BlobWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from '@zip.js/zip.js';
import { AppError } from './appError';

const sjis = new TextDecoder('shift-jis');

export interface FixResult {
  blob: Blob;
  total: number;
  fixed: number;
}

export async function fixZipNames(file: File): Promise<FixResult> {
  const reader = new ZipReader(new BlobReader(file));
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
  let fixed = 0;
  let total = 0;
  try {
    const entries = await reader.getEntries();
    total = entries.length;
    for (const e of entries) {
      if (e.encrypted) throw new AppError('errEncryptedArchive');

      let name = e.filename;
      // Only touch names that were NOT stored as UTF-8 (else risk a double-decode).
      if (!e.filenameUTF8 && e.rawFilename) {
        const decoded = sjis.decode(e.rawFilename);
        if (decoded && decoded !== e.filename) {
          name = decoded;
          fixed += 1;
        }
      }

      if (e.directory) {
        await writer.add(name, undefined, { directory: true });
      } else {
        const data = await e.getData!(new Uint8ArrayWriter());
        await writer.add(name, new Uint8ArrayReader(data));
      }
    }
  } finally {
    await reader.close();
  }
  const blob = await writer.close();
  return { blob, total, fixed };
}
