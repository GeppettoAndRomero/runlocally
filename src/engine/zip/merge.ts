/**
 * Merge several .zip files into one, entirely in the browser (@zip.js/zip.js).
 *
 * One `ZipReader` per input reads its central directory and streams each entry's
 * bytes into a single shared `ZipWriter`. Folder structure is preserved because
 * every entry keeps its full path (e.g. `docs/readme.txt`), and explicit folder
 * entries are carried over once so empty directories survive too.
 *
 * Name collisions (the same path in two inputs) are handled explicitly and never
 * silently overwritten:
 *  - 'rename' keeps BOTH — the later one gets a numeric suffix
 *    (`docs/readme.txt` → `docs/readme (1).txt`).
 *  - 'skip' keeps the FIRST occurrence and drops later duplicates.
 * The number of collisions resolved is reported back so the UI can tell the user.
 *
 * `useUnicodeFileNames` sets the UTF-8 language-encoding flag (general-purpose
 * bit 11) on every entry, so non-ASCII names extract correctly on Windows.
 */

import { ZipReader, ZipWriter, BlobReader, BlobWriter } from '@zip.js/zip.js';
import { EngineError } from '../errors';
import { readCentralEntries } from './list';

export type CollisionStrategy = 'rename' | 'skip';

export interface MergeProgress {
  index: number; // 0-based index of the input archive being read
  total: number; // number of input archives
  name: string; // file name of that archive
}

export interface MergeStats {
  /** Number of input .zip files combined. */
  inputs: number;
  /** Number of file entries written to the output (excludes folder entries). */
  entries: number;
  /** Number of duplicate-path file entries found across inputs. */
  collisions: number;
  /** Duplicates dropped (only when strategy is 'skip'). */
  skipped: number;
}

export interface MergeResult {
  blob: Blob;
  stats: MergeStats;
}

export interface MergeOptions {
  collision: CollisionStrategy;
}

/**
 * Give `path` a name not already in `used`, keeping any folder prefix and putting
 * the ` (n)` suffix before the extension: `docs/a.txt` → `docs/a (1).txt`.
 * Adds the chosen name to `used` and returns it.
 */
export function disambiguate(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let n = 1;
  let candidate = `${dir}${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${dir}${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

export async function mergeZips(
  files: File[],
  options: MergeOptions,
  onProgress?: (p: MergeProgress) => void,
): Promise<MergeResult> {
  if (files.length < 2) {
    throw new EngineError('unsupported', 'Need at least two ZIP files to merge');
  }

  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    useUnicodeFileNames: true,
  });

  const usedFiles = new Set<string>();
  const usedDirs = new Set<string>();
  let entries = 0;
  let collisions = 0;
  let skipped = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      onProgress?.({ index: i, total: files.length, name: files[i].name });

      const reader = new ZipReader(new BlobReader(files[i]));
      try {
        let zipEntries;
        try {
          zipEntries = await readCentralEntries(reader);
        } catch (error) {
          if (error instanceof EngineError) {
            throw new EngineError(error.code, `Cannot read ZIP file: ${files[i].name}`, {
              cause: error.cause ?? error,
            });
          }
          throw error;
        }

        for (const entry of zipEntries) {
          if (entry.directory) {
            // Carry folder entries over once so empty directories are preserved.
            if (!usedDirs.has(entry.filename)) {
              usedDirs.add(entry.filename);
              await writer.add(entry.filename, undefined, { directory: true });
            }
            continue;
          }

          let name: string;
          if (usedFiles.has(entry.filename)) {
            collisions += 1;
            if (options.collision === 'skip') {
              skipped += 1;
              continue;
            }
            name = disambiguate(entry.filename, usedFiles);
          } else {
            usedFiles.add(entry.filename);
            name = entry.filename;
          }

          if (entry.encrypted) throw new EngineError('encrypted-entry', `Entry is encrypted: ${entry.filename}`);
          const data = await entry.getData(new BlobWriter());
          await writer.add(name, new BlobReader(data));
          entries += 1;
        }
      } finally {
        await reader.close().catch(() => {});
      }
    }

    const blob = await writer.close();
    return { blob, stats: { inputs: files.length, entries, collisions, skipped } };
  } catch (error) {
    await writer.close().catch(() => {});
    throw error;
  }
}
