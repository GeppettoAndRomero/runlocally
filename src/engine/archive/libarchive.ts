import { Archive as BrowserArchive } from 'libarchive.js';
import { EngineError } from '../errors';

type ArchiveClass = typeof BrowserArchive;
let ArchiveImpl: ArchiveClass = BrowserArchive;
let initialized = false;

function initForBrowser(): void {
  if (initialized) return;
  ArchiveImpl.init({ workerUrl: '/vendor/libarchive/worker-bundle.js' });
  initialized = true;
}

/** Inject an already initialized archive implementation in Node tests. */
export function __setArchiveForTesting(impl: ArchiveClass): void {
  ArchiveImpl = impl;
  initialized = true;
}

interface CompressedFileHandle {
  name: string;
  size: number;
  extract(): Promise<File>;
}

interface FilesArrayItem {
  file: CompressedFileHandle;
  path: string;
}

export interface ArchiveEntryInfo {
  /** Full path within the archive. */
  path: string;
  /** Uncompressed size in bytes. */
  size: number;
}

export interface OpenArchive {
  entries: ArchiveEntryInfo[];
  extractOne(path: string): Promise<File>;
  /** Extracts in listing order, reports each completion, then closes on success. */
  extractAll(onProgress?: (done: number, total: number) => void): Promise<File[]>;
  /** Call after single extraction, failed extraction, or discarding the file. */
  close(): void;
}

/** Open and list extractable files. An empty listing may also mean unreadable input. */
export async function openArchive(file: File): Promise<OpenArchive> {
  try {
    initForBrowser();
  } catch (cause) {
    throw new EngineError('unsupported', 'Archive initialization failed', { cause });
  }

  let archive: Awaited<ReturnType<typeof ArchiveImpl.open>>;
  try {
    archive = await ArchiveImpl.open(file);
  } catch (cause) {
    throw new EngineError('unsupported', 'Cannot open archive', { cause });
  }

  // A failed encryption inquiry does not establish that the archive is unencrypted.
  let encrypted: boolean | null;
  try {
    encrypted = await archive.hasEncryptedData();
  } catch {
    encrypted = null;
  }
  if (encrypted) {
    await archive.close();
    throw new EngineError('encrypted-entry', 'Archive contains encrypted entries');
  }

  let items: FilesArrayItem[];
  try {
    items = (await archive.getFilesArray()) as FilesArrayItem[];
  } catch (cause) {
    await archive.close();
    throw new EngineError('unsupported', 'Cannot list archive', { cause });
  }

  if (items.length === 0) {
    await archive.close();
    throw new EngineError('unsupported', 'No extractable files in archive');
  }

  const byPath = new Map<string, CompressedFileHandle>();
  for (const item of items) byPath.set(`${item.path}${item.file.name}`, item.file);

  const entries: ArchiveEntryInfo[] = [...byPath.entries()]
    .map(([path, entry]) => ({ path, size: entry.size }))
    .sort((a, b) => a.path.localeCompare(b.path));

  async function extractOne(path: string): Promise<File> {
    const target = byPath.get(path);
    if (!target) throw new EngineError('unsupported', 'Archive path does not exist');
    try {
      return await target.extract();
    } catch (cause) {
      throw new EngineError('unsupported', 'Cannot extract archive entry', { cause });
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

/** The final segment, with trailing slashes removed. */
export function baseName(entryPath: string): string {
  const trimmed = entryPath.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}
