import { describe, it, expect, vi } from 'vitest';
import {
  configure, BlobWriter, TextReader, ZipReader, ZipWriter,
} from '@zip.js/zip.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EngineError } from '@/engine/errors';
import type { ZipEntry } from '@/engine/types';
import { baseName, isGarbled } from '@/engine/zip/names';
import { listEntries } from '@/engine/zip/list';
import { extractEntry, extractAll } from '@/engine/zip/extract';

configure({ useWebWorkers: false });

const unzipBytes = readFileSync(fileURLToPath(new URL('../fixtures/zip/sample.zip', import.meta.url)));
const viewerBytes = readFileSync(fileURLToPath(new URL('../fixtures/zip/viewer-sample.zip', import.meta.url)));
const unzipFile = () => new File([unzipBytes], 'sample.zip', { type: 'application/zip' });
const viewerFile = () => new File([viewerBytes], 'viewer-sample.zip', { type: 'application/zip' });
const badFile = () => new File([new Uint8Array([1, 2, 3, 4])], 'bad.zip');
const entry = (over: Partial<ZipEntry> = {}): ZipEntry => ({
  name: 'a.txt', directory: false, size: 1, compressedSize: 1,
  encrypted: false, utf8: true, ...over,
});

async function generatedZip(items: Array<{ name: string; directory?: boolean; password?: string }>): Promise<File> {
  const writer = new ZipWriter(new BlobWriter());
  for (const item of items) {
    await writer.add(item.name, item.directory ? undefined : new TextReader('content'), {
      directory: item.directory,
      password: item.password,
    });
  }
  return new File([await writer.close()], 'generated.zip');
}

describe('baseName', () => {
  it('returns the last path segment', () => {
    expect(baseName('docs/sub/deep.txt')).toBe('deep.txt');
    expect(baseName('readme.txt')).toBe('readme.txt');
  });
  it('strips trailing slashes from directory names', () => {
    expect(baseName('images/')).toBe('images');
  });
});

describe('isGarbled', () => {
  it('flags non-UTF-8 names with non-ASCII bytes', () => {
    expect(isGarbled(entry({ utf8: false, name: 'メモ.txt' }))).toBe(true);
  });
  it('does not flag ASCII names, or non-ASCII names stored as UTF-8', () => {
    expect(isGarbled(entry({ utf8: false, name: 'plain.txt' }))).toBe(false);
    expect(isGarbled(entry({ utf8: true, name: 'メモ.txt' }))).toBe(false);
  });
});

describe('listEntries (unzip fixture)', () => {
  it('lists every entry, including nested folders and a directory entry', async () => {
    const entries = await listEntries(unzipFile());
    const names = entries.map((e) => e.name);
    expect(entries).toHaveLength(5);
    expect(names).toEqual(['readme.txt', 'docs/notes.txt', 'docs/sub/deep.txt', 'メモ.txt', 'images/']);
    expect(entries[4].directory).toBe(true);
  });
  it('reports size and non-encrypted for a plain entry, and does not flag ASCII names', async () => {
    const readme = (await listEntries(unzipFile())).find((e) => e.name === 'readme.txt')!;
    expect(readme.size).toBeGreaterThan(0);
    expect(readme.compressedSize).toBeGreaterThan(0);
    expect(readme.encrypted).toBe(false);
    expect(isGarbled(readme)).toBe(false);
  });
  it('marks the non-ASCII UTF-8 name as UTF-8 (not garbled)', async () => {
    const memo = (await listEntries(unzipFile())).find((e) => e.name === 'メモ.txt')!;
    expect(memo.utf8).toBe(true);
    expect(isGarbled(memo)).toBe(false);
  });
  it('throws on a non-zip blob', async () => {
    await expect(listEntries(badFile())).rejects.toThrow();
  });
});

describe('listEntries (viewer fixture)', () => {
  it('lists entries with their names', async () => {
    const names = (await listEntries(viewerFile())).map((e) => e.name);
    expect(names).toContain('readme.txt');
    expect(names).toContain('日本語フォルダ/メモ.txt');
  });
  it('marks UTF-8 filenames and reports size + non-encrypted', async () => {
    const entries = await listEntries(viewerFile());
    const readme = entries.find((e) => e.name === 'readme.txt')!;
    expect(readme.size).toBeGreaterThan(0);
    expect(readme.encrypted).toBe(false);
    expect(readme.utf8).toBe(true);
    expect(readme.date instanceof Date || readme.date === undefined).toBe(true);
  });
  it('throws on a non-zip blob', async () => {
    await expect(listEntries(badFile())).rejects.toThrow();
  });
});

describe('extractEntry', () => {
  it('extracts a single file to a Blob with the right contents', async () => {
    expect(await (await extractEntry(unzipFile(), 'readme.txt')).text()).toBe('hello from unzip\n');
  });
  it('extracts a UTF-8-named nested file', async () => {
    expect(await (await extractEntry(unzipFile(), 'メモ.txt')).text()).toBe('日本語\n');
  });
  it('throws for a missing name with unsupported code', async () => {
    await expect(extractEntry(unzipFile(), 'nope.txt')).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('rejects a directory with unsupported code', async () => {
    await expect(extractEntry(unzipFile(), 'images/')).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('rejects an encrypted entry with encrypted-entry code', async () => {
    const file = await generatedZip([{ name: 'locked.txt', password: 'secret' }]);
    expect((await listEntries(file))[0].encrypted).toBe(true);
    await expect(extractEntry(file, 'locked.txt')).rejects.toMatchObject({ code: 'encrypted-entry' });
  });
});

describe('extractAll', () => {
  it('extracts every file (not directories) and reports progress', async () => {
    const seen: Array<[number, number]> = [];
    const files = await extractAll(unzipFile(), (done, total) => seen.push([done, total]));
    expect(files.map((f) => f.name).sort()).toEqual(
      ['docs/notes.txt', 'docs/sub/deep.txt', 'readme.txt', 'メモ.txt'].sort(),
    );
    expect(files).toHaveLength(4);
    expect(seen.map(([done]) => done)).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });
  it('skips encrypted entries and counts only extraction targets', async () => {
    const file = await generatedZip([
      { name: 'folder/', directory: true },
      { name: 'locked.txt', password: 'secret' },
      { name: 'folder/open.txt' },
    ]);
    const seen: Array<[number, number]> = [];
    const files = await extractAll(file, (done, total) => seen.push([done, total]));
    expect(files.map((item) => item.name)).toEqual(['folder/open.txt']);
    expect(await files[0].blob.text()).toBe('content');
    expect(seen).toEqual([[1, 1]]);
  });
  it('returns no files or progress when every entry is skipped', async () => {
    const file = await generatedZip([{ name: 'folder/', directory: true }, { name: 'locked.txt', password: 'secret' }]);
    const progress = vi.fn();
    expect(await extractAll(file, progress)).toEqual([]);
    expect(progress).not.toHaveBeenCalled();
  });
  it('passes through a progress callback exception and closes the reader', async () => {
    const error = new Error('callback failed');
    const close = vi.spyOn(ZipReader.prototype, 'close');
    try {
      await expect(extractAll(unzipFile(), () => { throw error; })).rejects.toBe(error);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });
});

describe('errors and reader lifetime', () => {
  it('preserves code, name, and cause on EngineError', () => {
    const cause = new Error('original');
    const error = new EngineError('bad-central', 'invalid directory', { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EngineError');
    expect(error.code).toBe('bad-central');
    expect(error.cause).toBe(cause);
  });
  it('wraps a malformed central directory with its cause and closes the reader', async () => {
    const close = vi.spyOn(ZipReader.prototype, 'close');
    try {
      let caught: unknown;
      try { await listEntries(badFile()); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(EngineError);
      expect(caught).toMatchObject({ code: 'bad-central' });
      expect((caught as EngineError).cause).toBeInstanceOf(Error);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });
  it('closes the reader when entry extraction is rejected', async () => {
    const close = vi.spyOn(ZipReader.prototype, 'close');
    try {
      await expect(extractEntry(unzipFile(), 'missing')).rejects.toMatchObject({ code: 'unsupported' });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });
  it('does not classify unrelated entry-list errors as bad-central', async () => {
    const error = new Error('unrelated failure');
    const getEntries = vi.spyOn(ZipReader.prototype, 'getEntries').mockRejectedValueOnce(error);
    try {
      await expect(listEntries(unzipFile())).rejects.toBe(error);
    } finally {
      getEntries.mockRestore();
    }
  });
});
