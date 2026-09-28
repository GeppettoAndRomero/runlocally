import { describe, it, expect } from 'vitest';
import { configure, ZipReader, BlobReader, TextWriter, type Entry } from '@zip.js/zip.js';
import { createZip } from './create-split-merge-port/create';
import { createEncryptedZip } from './create-split-merge-port/encrypt';

// In Node (vitest) there are no Web Workers; compress inline.
configure({ useWebWorkers: false });

const file = (name: string, content: string) =>
  new File([content], name, { type: 'text/plain' });

async function entryNames(blob: Blob): Promise<string[]> {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  await reader.close();
  return entries.map((e) => e.filename);
}

describe('createZip', () => {
  it('archives multiple files and reads them back', async () => {
    const blob = await createZip([file('a.txt', 'AAA'), file('日本語.txt', 'BBB')]);
    expect(blob.type).toBe('application/zip');
    expect((await entryNames(blob)).sort()).toEqual(['a.txt', '日本語.txt'].sort());
  });

  it('sets the UTF-8 flag (bit 11) so non-ASCII names survive on Windows', async () => {
    const blob = await createZip([file('日本語.txt', 'x')]);
    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    await reader.close();
    expect(entries[0].filenameUTF8).toBe(true);
  });

  it('disambiguates duplicate names', async () => {
    const blob = await createZip([file('a.txt', '1'), file('a.txt', '2'), file('a.txt', '3')]);
    expect((await entryNames(blob)).sort()).toEqual(['a (1).txt', 'a (2).txt', 'a.txt'].sort());
  });

  it('disambiguates duplicate names that have no extension', async () => {
    const blob = await createZip([file('LICENSE', '1'), file('LICENSE', '2')]);
    expect((await entryNames(blob)).sort()).toEqual(['LICENSE', 'LICENSE (1)'].sort());
  });

  it('uses the folder-relative path when present', async () => {
    const f = file('photo.txt', 'x');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'album/photo.txt' });
    expect(await entryNames(await createZip([f]))).toEqual(['album/photo.txt']);
  });

  it('reports progress per file', async () => {
    const seen: number[] = [];
    await createZip([file('a', '1'), file('b', '2')], (p) => seen.push(p.index));
    expect(seen).toEqual([0, 1]);
  });

  it('rejects an empty file list', async () => {
    await expect(createZip([])).rejects.toThrow();
  });
});

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b; // 'PK'

/** Read entries; a password is passed to the reader so encrypted data can be read. */
async function open(blob: Blob, password?: string): Promise<{ entries: Entry[]; close: () => Promise<void> }> {
  const reader = new ZipReader(new BlobReader(blob), password ? { password } : undefined);
  const entries = await reader.getEntries();
  return { entries, close: () => reader.close() };
}

async function readText(entry: Entry): Promise<string> {
  if (entry.directory) throw new Error('not a file');
  return entry.getData!(new TextWriter());
}

describe('createEncryptedZip', () => {
  it('produces a valid .zip (PK magic bytes) with entries flagged as encrypted', async () => {
    const blob = await createEncryptedZip([file('secret.txt', 'top secret')], 'hunter2');
    expect(blob.type).toBe('application/zip');
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    expect(isZip(head)).toBe(true);

    const { entries, close } = await open(blob, 'hunter2');
    expect(entries).toHaveLength(1);
    expect(entries[0].filename).toBe('secret.txt');
    expect(entries[0].encrypted).toBe(true);
    await close();
  });

  it('round-trips: decrypts with the correct password', async () => {
    const blob = await createEncryptedZip([file('a.txt', 'AAA'), file('日本語.txt', 'BBB')], 'p@ss');
    const { entries, close } = await open(blob, 'p@ss');
    const byName = Object.fromEntries(entries.map((e) => [e.filename, e]));
    expect(await readText(byName['a.txt'])).toBe('AAA');
    expect(await readText(byName['日本語.txt'])).toBe('BBB');
    await close();
  });

  it('fails to decrypt with the wrong password', async () => {
    const blob = await createEncryptedZip([file('secret.txt', 'top secret')], 'hunter2');
    const { entries, close } = await open(blob, 'wrong-password');
    await expect(readText(entries[0])).rejects.toThrow();
    await close();
  });

  it('fails to decrypt with no password at all', async () => {
    const blob = await createEncryptedZip([file('secret.txt', 'top secret')], 'hunter2');
    const { entries, close } = await open(blob);
    await expect(readText(entries[0])).rejects.toThrow();
    await close();
  });

  it('keeps the UTF-8 filename flag so non-ASCII names survive on Windows', async () => {
    const blob = await createEncryptedZip([file('日本語.txt', 'x')], 'pw');
    const { entries, close } = await open(blob, 'pw');
    expect(entries[0].filenameUTF8).toBe(true);
    await close();
  });

  it('disambiguates duplicate names', async () => {
    const blob = await createEncryptedZip(
      [file('a.txt', '1'), file('a.txt', '2'), file('a.txt', '3')],
      'pw'
    );
    const { entries, close } = await open(blob, 'pw');
    expect(entries.map((e) => e.filename).sort()).toEqual(['a (1).txt', 'a (2).txt', 'a.txt'].sort());
    await close();
  });

  it('uses the folder-relative path when present', async () => {
    const f = file('photo.txt', 'x');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'album/photo.txt' });
    const { entries, close } = await open(await createEncryptedZip([f], 'pw'), 'pw');
    expect(entries[0].filename).toBe('album/photo.txt');
    await close();
  });

  it('reports progress per file', async () => {
    const seen: number[] = [];
    await createEncryptedZip([file('a', '1'), file('b', '2')], 'pw', (p) => seen.push(p.index));
    expect(seen).toEqual([0, 1]);
  });

  it('rejects an empty file list', async () => {
    await expect(createEncryptedZip([], 'pw')).rejects.toThrow();
  });

  it('rejects an empty password', async () => {
    await expect(createEncryptedZip([file('a.txt', '1')], '')).rejects.toThrow();
  });
});
