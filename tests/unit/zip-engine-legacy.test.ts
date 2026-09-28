import { describe, it, expect } from 'vitest';
import { configure } from '@zip.js/zip.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  listZip,
  extractEntry,
  extractAll,
  baseName,
  isGarbled,
  type ZipEntry,
} from '@/engine/zip/unzip-legacy';

// Run the engine synchronously in Node (no Web Workers available here).
configure({ useWebWorkers: false });

const buf = readFileSync(fileURLToPath(new URL('../fixtures/zip/sample.zip', import.meta.url)));
const zipFile = () => new File([buf], 'sample.zip', { type: 'application/zip' });

const entry = (over: Partial<ZipEntry> = {}): ZipEntry => ({
  name: 'a.txt',
  directory: false,
  size: 1,
  compressedSize: 1,
  encrypted: false,
  utf8: true,
  ...over,
});

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

describe('listZip', () => {
  it('lists every entry, including nested folders and a directory entry', async () => {
    const entries = await listZip(zipFile());
    const names = entries.map((e) => e.name);
    expect(entries).toHaveLength(5);
    expect(names).toContain('readme.txt');
    expect(names).toContain('docs/notes.txt');
    expect(names).toContain('docs/sub/deep.txt');
    expect(names).toContain('メモ.txt');
    const dir = entries.find((e) => e.name === 'images/')!;
    expect(dir.directory).toBe(true);
  });

  it('reports size and non-encrypted for a plain entry, and does not flag ASCII names', async () => {
    const readme = (await listZip(zipFile())).find((e) => e.name === 'readme.txt')!;
    expect(readme.size).toBeGreaterThan(0);
    expect(readme.encrypted).toBe(false);
    // An ASCII name is not stored with the UTF-8 flag, but it is never mojibake.
    expect(isGarbled(readme)).toBe(false);
  });

  it('marks the non-ASCII UTF-8 name as UTF-8 (not garbled)', async () => {
    const memo = (await listZip(zipFile())).find((e) => e.name === 'メモ.txt')!;
    expect(memo.utf8).toBe(true);
    expect(isGarbled(memo)).toBe(false);
  });

  it('throws on a non-zip blob', async () => {
    await expect(
      listZip(new File([new Uint8Array([1, 2, 3, 4])], 'x.zip')),
    ).rejects.toThrow();
  });
});

describe('extractEntry', () => {
  it('extracts a single file to a Blob with the right contents', async () => {
    const blob = await extractEntry(zipFile(), 'readme.txt');
    expect(await blob.text()).toBe('hello from unzip\n');
  });

  it('extracts a UTF-8-named nested file', async () => {
    const blob = await extractEntry(zipFile(), 'メモ.txt');
    expect(await blob.text()).toBe('日本語\n');
  });

  it('throws for a missing name', async () => {
    await expect(extractEntry(zipFile(), 'nope.txt')).rejects.toThrow();
  });
});

describe('extractAll', () => {
  it('extracts every file (not directories) and reports progress', async () => {
    const seen: number[] = [];
    const files = await extractAll(zipFile(), (done) => seen.push(done));
    expect(files.map((f) => f.name).sort()).toEqual(
      ['docs/notes.txt', 'docs/sub/deep.txt', 'readme.txt', 'メモ.txt'].sort(),
    );
    // 4 files, no directory entry.
    expect(files).toHaveLength(4);
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
