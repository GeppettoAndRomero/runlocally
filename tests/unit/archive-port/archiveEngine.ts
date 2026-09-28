/** Temporary archive engine port for the stage A regression tests. */
import { Archive as BrowserArchive } from 'libarchive.js';
import { AppError } from './appError';

type ArchiveClass = typeof BrowserArchive;

// The libarchive.js `Archive` class actually in use. Defaults to the browser
// build (spins up a real Worker); unit tests swap this for libarchive.js's
// Node (`worker_threads`) build via `__setArchiveForTesting`, since rollup
// bundles each dist entry point as a fully self-contained file — the browser
// and Node builds are NOT the same class object, so this must be swappable
// rather than a shared singleton.
let ArchiveImpl: ArchiveClass = BrowserArchive;
let initialized = false;

/**
 * Point the library at the vendored worker + WASM (see scripts/vendor-libarchive.mjs).
 * Idempotent; called lazily by `openArchive()` on first use.
 */
function initForBrowser(): void {
  if (initialized) return;
  ArchiveImpl.init({ workerUrl: '/vendor/libarchive/worker-bundle.js' });
  initialized = true;
}

/**
 * Test-only: use a different (already-initialized) `Archive` implementation —
 * e.g. libarchive.js's Node entry point, which self-configures for
 * `worker_threads` on import — instead of the browser one, and skip
 * `initForBrowser()` so that configuration is not overwritten.
 */
export function __setArchiveForTesting(impl: ArchiveClass): void {
  ArchiveImpl = impl;
  initialized = true;
}

/** A libarchive.js `CompressedFile` — the shape actually used here. */
interface CompressedFileHandle {
  name: string;
  size: number;
  extract(): Promise<File>;
}

/** One row of `Archive.getFilesArray()`: a file plus the folder prefix above it. */
interface FilesArrayItem {
  file: CompressedFileHandle;
  path: string;
}

export interface ArchiveEntryInfo {
  /** Full path within the archive, e.g. "docs/notes.txt". */
  path: string;
  /** Uncompressed size in bytes. libarchive.js does not expose a per-entry
   *  compressed size (several formats, e.g. solid 7z, do not have one to give). */
  size: number;
}

/** An open archive: the live worker/WASM handle plus the file list read from it. */
export interface OpenArchive {
  entries: ArchiveEntryInfo[];
  /** Extract one entry (by its path from `entries`) to a File. */
  extractOne(path: string): Promise<File>;
  /** Extract every entry in listing order. Terminates the worker when done — call last. */
  extractAll(onProgress?: (done: number, total: number) => void): Promise<File[]>;
  /** Release the worker without extracting (call when the user clears/replaces the file). */
  close(): void;
}

/**
 * Open an archive and list its entries. Throws `AppError`:
 * - `errArchiveEncrypted` — the archive has password-protected entries.
 * - `errInvalidArchive` — not a readable archive (corrupt, or an unsupported format).
 * - `errEmpty` — a valid, readable archive with no file entries.
 */
export async function openArchive(file: File): Promise<OpenArchive> {
  initForBrowser();

  let archive: Awaited<ReturnType<typeof ArchiveImpl.open>>;
  try {
    archive = await ArchiveImpl.open(file);
  } catch {
    throw new AppError('errInvalidArchive', { name: file.name });
  }

  // Archive-level encryption check (peeks the first entry's header only).
  let encrypted: boolean | null;
  try {
    encrypted = await archive.hasEncryptedData();
  } catch {
    encrypted = null;
  }
  if (encrypted) {
    await archive.close();
    throw new AppError('errArchiveEncrypted', { name: file.name });
  }

  let items: FilesArrayItem[];
  try {
    items = (await archive.getFilesArray()) as FilesArrayItem[];
  } catch {
    await archive.close();
    throw new AppError('errInvalidArchive', { name: file.name });
  }

  if (items.length === 0) {
    await archive.close();
    // Genuinely ambiguous by design, not a bug: libarchive.js's underlying C
    // wrapper does not fail archive_open() on unrecognized/garbage input (it
    // only logs to stderr), so a real empty archive, a completely unreadable
    // file, AND a header-encrypted archive (rare; e.g. RAR5 "encrypt file
    // names too") all surface identically here — a successful open with zero
    // listable entries. `errEmpty`'s wording ("nothing to extract") is chosen
    // to be honest for all three rather than falsely specific to one.
    throw new AppError('errEmpty', { name: file.name });
  }

  const byPath = new Map<string, CompressedFileHandle>();
  for (const item of items) byPath.set(`${item.path}${item.file.name}`, item.file);

  const entries: ArchiveEntryInfo[] = [...byPath.entries()]
    .map(([path, f]) => ({ path, size: f.size }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Plain closures rather than object-literal methods using `this`: `this`
  // inside a method shorthand returned from an async function does not infer
  // cleanly (TS resolves it against `OpenArchive | PromiseLike<OpenArchive>`).
  async function extractOne(path: string): Promise<File> {
    const target = byPath.get(path);
    if (!target) throw new AppError('errInvalidArchive', { name: path });
    try {
      return await target.extract();
    } catch {
      throw new AppError('errInvalidArchive', { name: path });
    }
  }

  async function extractAll(onProgress?: (done: number, total: number) => void): Promise<File[]> {
    const out: File[] = [];
    let done = 0;
    for (const entry of entries) {
      out.push(await extractOne(entry.path));
      done += 1;
      onProgress?.(done, entries.length);
    }
    archive.close();
    return out;
  }

  return {
    entries,
    extractOne,
    extractAll,
    close(): void {
      archive.close();
    },
  };
}

/** The last path segment of an entry path (its file name without folders). */
export function baseName(entryPath: string): string {
  const trimmed = entryPath.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}
