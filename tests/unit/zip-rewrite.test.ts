import { describe, it, expect, beforeAll } from 'vitest';
import {
  configure, ZipReader, ZipWriter, BlobReader, BlobWriter, TextReader, TextWriter,
  type Entry,
} from '@zip.js/zip.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listZip, buildTrimmedZip } from './rewrite-port/remove';
import { fixZipNames } from './rewrite-port/filename-fix';
import { unlockZip, WrongPasswordError, NotEncryptedError } from './rewrite-port/unlock';
import { createEncryptedZip } from './rewrite-port/encrypt';

configure({ useWebWorkers: false });
{

// No web workers under vitest's node env.
configure({ useWebWorkers: false });

const buf = readFileSync(fileURLToPath(new URL('../fixtures/zip/rewrite/remove-sample.zip', import.meta.url)));
const zipFile = () => new File([buf], 'sample.zip', { type: 'application/zip' });

async function namesOf(blob: Blob): Promise<string[]> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    return (await reader.getEntries()).map((e) => e.filename);
  } finally {
    await reader.close();
  }
}

describe('listZip', () => {
  it('lists the entries with their names', async () => {
    const names = (await listZip(zipFile())).map((e) => e.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.txt');
    expect(names).toContain('docs/guide.txt');
    expect(names).toContain('写真/メモ.txt');
  });

  it('reports size, UTF-8 flag and non-encrypted for a plain entry', async () => {
    const a = (await listZip(zipFile())).find((e) => e.name === 'a.txt')!;
    expect(a.size).toBeGreaterThan(0);
    expect(a.encrypted).toBe(false);
    expect(a.utf8).toBe(true);
  });

  it('throws on a non-zip blob', async () => {
    await expect(listZip(new File([new Uint8Array([1, 2, 3, 4])], 'x.zip'))).rejects.toThrow();
  });
});

describe('buildTrimmedZip', () => {
  it('drops the removed file and keeps the rest, with correct counts', async () => {
    const removed = new Set(['b.txt']);
    const out = await buildTrimmedZip(zipFile(), (name) => !removed.has(name));
    const names = await namesOf(out.blob);

    expect(names).not.toContain('b.txt');
    expect(names).toContain('a.txt');
    expect(names).toContain('docs/guide.txt');
    expect(names).toContain('写真/メモ.txt');
    // One entry removed; every other source entry kept.
    expect(out.removed).toBe(1);
    const total = (await listZip(zipFile())).length;
    expect(out.kept).toBe(total - 1);
  });

  it('removing a folder drops its children too', async () => {
    const removedPrefix = 'docs/';
    const out = await buildTrimmedZip(
      zipFile(),
      (name) => !(name === removedPrefix || name.startsWith(removedPrefix))
    );
    const names = await namesOf(out.blob);
    expect(names.some((n) => n.startsWith('docs/'))).toBe(false);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.txt');
  });

  it('preserves the exact bytes of a kept entry', async () => {
    const out = await buildTrimmedZip(zipFile(), (name) => name === 'a.txt');
    const reader = new ZipReader(new BlobReader(out.blob));
    try {
      const [entry] = await reader.getEntries();
      expect(entry.filename).toBe('a.txt');
      if (entry.directory) throw new Error('expected a file entry');
      const text = await entry.getData(new TextWriter());
      expect(text).toBe('alpha');
    } finally {
      await reader.close();
    }
  });
});

}
{

configure({ useWebWorkers: false });
const buf = readFileSync(fileURLToPath(new URL('../fixtures/zip/rewrite/mojibake.zip', import.meta.url)));
const mojibake = () => new File([buf], 'mojibake.zip', { type: 'application/zip' });

async function names(blob: Blob): Promise<string[]> {
  const r = new ZipReader(new BlobReader(blob));
  const e = await r.getEntries();
  await r.close();
  return e.map((x) => x.filename);
}

describe('fixZipNames', () => {
  it('re-decodes a CP932 filename to correct UTF-8', async () => {
    const { blob, total, fixed } = await fixZipNames(mojibake());
    expect(total).toBe(1);
    expect(fixed).toBe(1);
    expect(await names(blob)).toEqual(['メモ帳.txt']);
  });

  it('marks the rewritten names as UTF-8', async () => {
    const { blob } = await fixZipNames(mojibake());
    const r = new ZipReader(new BlobReader(blob));
    const e = await r.getEntries();
    await r.close();
    expect(e[0].filenameUTF8).toBe(true);
  });

  it('does not change file contents', async () => {
    const { blob } = await fixZipNames(mojibake());
    const r = new ZipReader(new BlobReader(blob));
    const e = await r.getEntries();
    const { TextWriter } = await import('@zip.js/zip.js');
    if (e[0].directory) throw new Error('expected a file entry');
    const text = await e[0].getData!(new TextWriter());
    await r.close();
    expect(text).toBe('これは日本語のメモです。');
  });

  it('leaves an already-UTF-8 zip unchanged (no double-decode)', async () => {
    // Build a clean UTF-8 zip, run it through, expect fixed=0 and same name.
    const { ZipWriter, BlobWriter, TextReader } = await import('@zip.js/zip.js');
    const w = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
    await w.add('日本語.txt', new TextReader('x'));
    const clean = new File([await w.close()], 'clean.zip', { type: 'application/zip' });
    const { fixed } = await fixZipNames(clean);
    expect(fixed).toBe(0);
  });
});

}
{

const PASSWORD = 'correct horse battery staple';

// Node has no DOM Worker; run zip.js inline so the engine works under vitest.
beforeAll(() => configure({ useWebWorkers: false }));

interface FileSpec {
  name: string;
  body: string;
}

const SAMPLE: FileSpec[] = [
  { name: 'hello.txt', body: 'This is a secret file.\n' },
  { name: 'docs/readme.md', body: '# Nested\nkeeps the folder path\n' },
];

/** Build an AES-encrypted zip (mirrors what 7-Zip / WinRAR produce). */
async function makeProtectedZip(password = PASSWORD): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    password,
    encryptionStrength: 3,
  });
  await writer.add('docs/', undefined, { directory: true });
  for (const f of SAMPLE) {
    await writer.add(f.name, new TextReader(f.body));
  }
  return writer.close();
}

/** Build a plain (unencrypted) zip. */
async function makePlainZip(): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('plain.txt', new TextReader('no password here'));
  return writer.close();
}

/** Read every file entry of a zip WITHOUT a password; returns name -> text. */
async function readWithoutPassword(
  blob: Blob
): Promise<{ contents: Record<string, string>; anyEncrypted: boolean; names: string[] }> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const contents: Record<string, string> = {};
    let anyEncrypted = false;
    for (const e of entries) {
      if (e.encrypted) anyEncrypted = true;
      if (e.directory) continue;
      // No password passed — must succeed for an unlocked archive.
      contents[e.filename] = await e.getData!(new TextWriter());
    }
    return { contents, anyEncrypted, names: entries.map((e) => e.filename) };
  } finally {
    await reader.close();
  }
}

describe('unlockZip', () => {
  it('removes the password so the output opens WITHOUT one', async () => {
    const protectedZip = await makeProtectedZip();
    const { blob, encryptedCount } = await unlockZip(protectedZip, PASSWORD);
    // Every entry (files + the directory) carries the encrypted flag.
    expect(encryptedCount).toBeGreaterThanOrEqual(SAMPLE.length);

    const { contents, anyEncrypted } = await readWithoutPassword(blob);
    expect(anyEncrypted).toBe(false);
    for (const f of SAMPLE) {
      expect(contents[f.name]).toBe(f.body);
    }
  });

  it('preserves the folder structure (directory + nested paths)', async () => {
    const protectedZip = await makeProtectedZip();
    const { blob } = await unlockZip(protectedZip, PASSWORD);
    const { names } = await readWithoutPassword(blob);
    expect(names).toContain('docs/');
    expect(names).toContain('docs/readme.md');
  });

  it('reports progress for every entry', async () => {
    const protectedZip = await makeProtectedZip();
    const seen: number[] = [];
    await unlockZip(protectedZip, PASSWORD, (p) => {
      seen.push(p.index);
      expect(p.total).toBe(SAMPLE.length + 1); // files + the directory entry
    });
    expect(seen.length).toBe(SAMPLE.length + 1);
  });

  it('throws WrongPasswordError for an incorrect password', async () => {
    const protectedZip = await makeProtectedZip();
    await expect(unlockZip(protectedZip, 'not the password')).rejects.toBeInstanceOf(
      WrongPasswordError
    );
  });

  it('throws NotEncryptedError when the archive has no password', async () => {
    const plain = await makePlainZip();
    await expect(unlockZip(plain, PASSWORD)).rejects.toBeInstanceOf(NotEncryptedError);
  });
});

}
{

// In Node (vitest) there are no Web Workers; compress/decrypt inline.
configure({ useWebWorkers: false });

const file = (name: string, content: string) =>
  new File([content], name, { type: 'text/plain' });

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

}
