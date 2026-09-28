import { describe, it, expect } from 'vitest';
import {
  configure,
  ZipWriter,
  BlobWriter,
  TextReader,
  ZipReader,
  BlobReader,
  TextWriter,
} from '@zip.js/zip.js';
import { mergeZips, disambiguate } from './create-split-merge-port/merge';

// In Node (vitest) there are no Web Workers; compress/decompress inline.
configure({ useWebWorkers: false });

type Entry = [name: string, content: string | null]; // null content => directory entry

async function makeZipFile(name: string, entries: Entry[]): Promise<File> {
  const w = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
  for (const [n, content] of entries) {
    if (content === null) await w.add(n, undefined, { directory: true });
    else await w.add(n, new TextReader(content));
  }
  const blob = await w.close();
  return new File([blob], name, { type: 'application/zip' });
}

async function readEntries(blob: Blob): Promise<Map<string, string | null>> {
  const r = new ZipReader(new BlobReader(blob));
  const map = new Map<string, string | null>();
  for (const e of await r.getEntries()) {
    map.set(e.filename, e.directory ? null : await e.getData!(new TextWriter()));
  }
  await r.close();
  return map;
}

describe('disambiguate', () => {
  it('returns the name unchanged when it is free', () => {
    const used = new Set<string>();
    expect(disambiguate('a.txt', used)).toBe('a.txt');
    expect(used.has('a.txt')).toBe(true);
  });

  it('adds a numeric suffix before the extension on a collision', () => {
    const used = new Set(['a.txt']);
    expect(disambiguate('a.txt', used)).toBe('a (1).txt');
  });

  it('keeps the folder prefix when disambiguating a nested path', () => {
    const used = new Set(['docs/readme.txt']);
    expect(disambiguate('docs/readme.txt', used)).toBe('docs/readme (1).txt');
  });

  it('handles names with no extension', () => {
    const used = new Set(['LICENSE']);
    expect(disambiguate('LICENSE', used)).toBe('LICENSE (1)');
  });

  it('increments past several existing duplicates', () => {
    const used = new Set(['a.txt', 'a (1).txt', 'a (2).txt']);
    expect(disambiguate('a.txt', used)).toBe('a (3).txt');
  });
});

describe('mergeZips', () => {
  it('combines every entry from all inputs', async () => {
    const a = await makeZipFile('a.zip', [['x.txt', 'X'], ['docs/one.txt', '1']]);
    const b = await makeZipFile('b.zip', [['y.txt', 'Y']]);
    const { blob, stats } = await mergeZips([a, b], { collision: 'rename' });
    const entries = await readEntries(blob);
    expect([...entries.keys()].sort()).toEqual(['docs/one.txt', 'x.txt', 'y.txt']);
    expect(stats.inputs).toBe(2);
    expect(stats.entries).toBe(3);
    expect(stats.collisions).toBe(0);
  });

  it('renames colliding paths and keeps both (default)', async () => {
    const a = await makeZipFile('a.zip', [['docs/readme.txt', 'A']]);
    const b = await makeZipFile('b.zip', [['docs/readme.txt', 'B']]);
    const { blob, stats } = await mergeZips([a, b], { collision: 'rename' });
    const entries = await readEntries(blob);
    expect(entries.get('docs/readme.txt')).toBe('A');
    expect(entries.get('docs/readme (1).txt')).toBe('B');
    expect(stats.collisions).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(stats.entries).toBe(2);
  });

  it('skips later duplicates when the strategy is skip', async () => {
    const a = await makeZipFile('a.zip', [['note.txt', 'first']]);
    const b = await makeZipFile('b.zip', [['note.txt', 'second']]);
    const { blob, stats } = await mergeZips([a, b], { collision: 'skip' });
    const entries = await readEntries(blob);
    expect([...entries.keys()]).toEqual(['note.txt']);
    expect(entries.get('note.txt')).toBe('first'); // first occurrence wins
    expect(stats.collisions).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.entries).toBe(1);
  });

  it('preserves nested folders and non-ASCII names', async () => {
    const a = await makeZipFile('a.zip', [['deep/nested/日本語.txt', 'hi']]);
    const b = await makeZipFile('b.zip', [['top.txt', 'x']]);
    const { blob } = await mergeZips([a, b], { collision: 'rename' });
    const entries = await readEntries(blob);
    expect(entries.has('deep/nested/日本語.txt')).toBe(true);
  });

  it('carries an explicit empty-directory entry over once', async () => {
    const a = await makeZipFile('a.zip', [['empty/', null], ['file.txt', 'x']]);
    const b = await makeZipFile('b.zip', [['empty/', null], ['other.txt', 'y']]);
    const { blob, stats } = await mergeZips([a, b], { collision: 'rename' });
    const entries = await readEntries(blob);
    const dirCount = [...entries.keys()].filter((k) => k === 'empty/').length;
    expect(dirCount).toBe(1); // shared folder is not duplicated…
    expect(stats.collisions).toBe(0); // …and is not counted as a collision
  });

  it('throws with fewer than two archives', async () => {
    const a = await makeZipFile('a.zip', [['x.txt', 'X']]);
    await expect(mergeZips([a], { collision: 'rename' })).rejects.toThrow();
  });

  it('throws a clear error when an input is not a valid ZIP', async () => {
    const good = await makeZipFile('good.zip', [['x.txt', 'X']]);
    const bad = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'bad.zip', {
      type: 'application/zip',
    });
    await expect(mergeZips([good, bad], { collision: 'rename' })).rejects.toThrow(/bad\.zip/);
  });
});
