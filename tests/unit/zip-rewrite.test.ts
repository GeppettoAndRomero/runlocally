import { describe, it, expect, vi } from 'vitest';
import {
  configure, ZipReader, ZipWriter, BlobReader, BlobWriter, TextReader, TextWriter,
  ERR_INVALID_AUTHENTICATION_CODE,
} from '@zip.js/zip.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rewriteZip } from '../../src/engine/zip/rewrite';
import { listEntries } from '../../src/engine/zip/list';
import { decodeShiftJisName } from '../../src/engine/zip/names';

configure({ useWebWorkers: false });

const sampleBytes = readFileSync(fileURLToPath(new URL('../fixtures/zip/rewrite/remove-sample.zip', import.meta.url)));
const mojibakeBytes = readFileSync(fileURLToPath(new URL('../fixtures/zip/rewrite/mojibake.zip', import.meta.url)));
const sample = () => new File([sampleBytes], 'sample.zip');
const mojibake = () => new File([mojibakeBytes], 'mojibake.zip');
const asFile = (blob: Blob) => new File([blob], 'input.zip');

async function archive(
  files: { name: string; text?: string; date?: Date; directory?: boolean; encrypted?: boolean }[],
  password?: string,
  zipCrypto = false,
): Promise<File> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
  for (const item of files) {
    await writer.add(item.name, item.directory ? undefined : new TextReader(item.text ?? ''), {
      directory: item.directory,
      lastModDate: item.date,
      ...(item.encrypted ? { password, zipCrypto, encryptionStrength: 3 } : {}),
    });
  }
  return asFile(await writer.close());
}

async function entriesOf(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob));
  try { return await reader.getEntries(); } finally { await reader.close(); }
}

async function namesOf(blob: Blob) {
  return (await entriesOf(blob)).map((entry) => entry.filename);
}

async function textOf(blob: Blob, name: string, password?: string) {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entry = (await reader.getEntries()).find((candidate) => candidate.filename === name);
    if (!entry || entry.directory) throw new Error('Expected a file entry');
    return await entry.getData(new TextWriter(), password === undefined ? undefined : { password });
  } finally { await reader.close(); }
}

async function errorCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'EngineError', code });
}

// zip.js does not mark directory entries encrypted. Set bit 0 in both ZIP headers
// so the reader sees an encrypted directory without changing its empty payload.
async function flagDirectoryEncrypted(input: File, name: string): Promise<File> {
  const bytes = new Uint8Array(await input.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const signature = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  while (end >= 0 && signature(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('ZIP end record not found');

  const count = view.getUint16(end + 10, true);
  let central = view.getUint32(end + 16, true);
  for (let index = 0; index < count; index++) {
    if (signature(central) !== 0x02014b50) throw new Error('Central header not found');
    const nameLength = view.getUint16(central + 28, true);
    const extraLength = view.getUint16(central + 30, true);
    const commentLength = view.getUint16(central + 32, true);
    const entryName = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength));
    if (entryName === name) {
      const local = view.getUint32(central + 42, true);
      if (signature(local) !== 0x04034b50) throw new Error('Local header not found');
      view.setUint16(local + 6, view.getUint16(local + 6, true) | 1, true);
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
      return new File([bytes], 'encrypted-directory.zip');
    }
    central += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('Directory entry not found');
}

describe('listEntries', () => {
  it('lists the entries with their names', async () => {
    expect((await listEntries(sample())).map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'a.txt', 'b.txt', 'docs/guide.txt', '写真/メモ.txt',
    ]));
  });
  it('reports size, UTF-8 flag and non-encrypted for a plain entry', async () => {
    const entry = (await listEntries(sample())).find((candidate) => candidate.name === 'a.txt')!;
    expect(entry.size).toBeGreaterThan(0);
    expect(entry.encrypted).toBe(false);
    expect(entry.utf8).toBe(true);
  });
  it('throws on a non-zip blob', async () => {
    await errorCode(listEntries(new File([new Uint8Array([1, 2, 3, 4])], 'x.zip')), 'bad-central');
  });
});

describe('rewriteZip: removal', () => {
  it('drops the removed file and keeps the rest, with correct counts', async () => {
    const out = await rewriteZip(sample(), { keep: (name) => name !== 'b.txt' });
    expect(await namesOf(out.blob)).not.toContain('b.txt');
    expect(await namesOf(out.blob)).toContain('写真/メモ.txt');
    expect(out).toMatchObject({ total: 5, kept: 4, removed: 1, renamed: 0, encryptedCount: 0 });
  });
  it('removing a folder drops its children too', async () => {
    const out = await rewriteZip(sample(), { keep: (name) => !name.startsWith('docs/') });
    expect((await namesOf(out.blob)).some((name) => name.startsWith('docs/'))).toBe(false);
    expect(await namesOf(out.blob)).toContain('a.txt');
  });
  it('preserves the exact bytes of a kept entry', async () => {
    const out = await rewriteZip(sample(), { keep: (name) => name === 'a.txt' });
    expect(await namesOf(out.blob)).toEqual(['a.txt']);
    expect(await textOf(out.blob, 'a.txt')).toBe('alpha');
  });
  it('keeps every entry by default and emits progress before filtering', async () => {
    const seen: { index: number; total: number; name: string }[] = [];
    const out = await rewriteZip(sample(), { onProgress: (progress) => seen.push(progress) });
    expect(out.kept).toBe(out.total);
    expect(seen).toHaveLength(out.total);
    expect(seen.map((progress) => progress.index)).toEqual([0, 1, 2, 3, 4]);
    expect(seen[0].name).toBe('a.txt');
  });
  it('reports each original entry before filtering, including removed entries', async () => {
    const seen: string[] = [];
    const input = await archive([
      { name: 'first.txt', text: 'a' },
      { name: 'dir/', directory: true },
      { name: 'dir/removed.txt', text: 'b' },
      { name: 'last.txt', text: 'c' },
    ]);
    const out = await rewriteZip(input, {
      keep: (name) => { seen.push(`keep:${name}`); return name !== 'dir/removed.txt'; },
      onProgress: ({ index, total, name }) => {
        expect(total).toBe(4);
        seen.push(`progress:${index}:${name}`);
      },
    });
    expect(out).toMatchObject({ total: 4, kept: 3, removed: 1 });
    expect(seen).toEqual([
      'progress:0:first.txt', 'keep:first.txt',
      'progress:1:dir/', 'keep:dir/',
      'progress:2:dir/removed.txt', 'keep:dir/removed.txt',
      'progress:3:last.txt', 'keep:last.txt',
    ]);
  });
  it('keeps an empty ZIP when every entry is removed', async () => {
    const out = await rewriteZip(sample(), { keep: () => false });
    expect(out).toMatchObject({ total: 5, kept: 0, removed: 5, renamed: 0 });
    expect(await namesOf(out.blob)).toEqual([]);
  });
  it('does not decrypt a removed encrypted entry', async () => {
    const input = await archive([{ name: 'secret', text: 'x', encrypted: true }, { name: 'plain', text: 'y' }], 'pw');
    const out = await rewriteZip(input, { keep: (name) => name !== 'secret' });
    expect(out).toMatchObject({ encryptedCount: 1, kept: 1, removed: 1 });
    expect(await textOf(out.blob, 'plain')).toBe('y');
  });
  it('rejects a kept encrypted entry in a mixed archive', async () => {
    const input = await archive([{ name: 'plain', text: 'y' }, { name: 'secret', text: 'x', encrypted: true }], 'pw');
    await errorCode(rewriteZip(input), 'encrypted-entry');
    const out = await rewriteZip(input, { password: 'pw' });
    expect(out.encryptedCount).toBe(1);
    expect(await textOf(out.blob, 'plain')).toBe('y');
    expect(await textOf(out.blob, 'secret')).toBe('x');
  });
});

describe('rewriteZip: names', () => {
  const rename = (_name: string, entry: Parameters<typeof decodeShiftJisName>[0]) => decodeShiftJisName(entry);
  it('re-decodes a CP932 filename to correct UTF-8', async () => {
    const out = await rewriteZip(mojibake(), { rename });
    expect(out).toMatchObject({ total: 1, renamed: 1 });
    expect(await namesOf(out.blob)).toEqual(['メモ帳.txt']);
  });
  it('marks the rewritten names as UTF-8', async () => {
    const out = await rewriteZip(mojibake(), { rename });
    expect((await entriesOf(out.blob))[0].filenameUTF8).toBe(true);
  });
  it('does not change file contents', async () => {
    const out = await rewriteZip(mojibake(), { rename });
    expect(await textOf(out.blob, 'メモ帳.txt')).toBe('これは日本語のメモです。');
  });
  it('leaves an already-UTF-8 zip unchanged (no double-decode)', async () => {
    const input = await archive([{ name: '日本語.txt', text: 'x' }]);
    const out = await rewriteZip(input, { rename });
    expect(out.renamed).toBe(0);
    expect(await namesOf(out.blob)).toEqual(['日本語.txt']);
  });
  it('renames only kept entries and tests keep against original names', async () => {
    const renameMock = vi.fn((name: string) => `new-${name}`);
    const out = await rewriteZip(sample(), { keep: (name) => name === 'a.txt', rename: renameMock });
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(out.renamed).toBe(1);
    expect(await namesOf(out.blob)).toEqual(['new-a.txt']);
  });
  it('preserves dates on renamed files and directories', async () => {
    const date = new Date('2020-02-04T12:30:00Z');
    const input = await archive([{ name: 'dir/', directory: true, date }, { name: 'dir/a.txt', text: 'a', date }]);
    const out = await rewriteZip(input, { rename: (name) => name.replace('dir', 'new') });
    expect(out.renamed).toBe(2);
    expect((await entriesOf(out.blob)).map((entry) => entry.lastModDate?.getTime())).toEqual([date.getTime(), date.getTime()]);
  });
});

describe('rewriteZip: password', () => {
  const protectedInput = () => archive([
    { name: 'docs/', directory: true, encrypted: true },
    { name: 'hello.txt', text: 'This is a secret file.\n', encrypted: true },
    { name: 'docs/readme.md', text: '# Nested\nkeeps the folder path\n', encrypted: true },
  ], 'correct horse battery staple');
  const password = 'correct horse battery staple';
  it('removes the password so the output opens WITHOUT one', async () => {
    const out = await rewriteZip(await protectedInput(), { password });
    expect(out.encryptedCount).toBeGreaterThanOrEqual(2);
    expect((await entriesOf(out.blob)).every((entry) => !entry.encrypted)).toBe(true);
    expect(await textOf(out.blob, 'hello.txt')).toBe('This is a secret file.\n');
  });
  it('preserves the folder structure (directory + nested paths)', async () => {
    const out = await rewriteZip(await protectedInput(), { password });
    expect(await namesOf(out.blob)).toEqual(['docs/', 'hello.txt', 'docs/readme.md']);
  });
  it('reports progress for every entry', async () => {
    const seen: number[] = [];
    await rewriteZip(await protectedInput(), { password, onProgress: (progress) => {
      seen.push(progress.index);
      expect(progress.total).toBe(3);
    } });
    expect(seen).toEqual([0, 1, 2]);
  });
  it('reports wrong-password for an incorrect password', async () => {
    await errorCode(rewriteZip(await protectedInput(), { password: 'not the password' }), 'wrong-password');
  });
  it('reports not-encrypted when the archive has no password', async () => {
    await errorCode(rewriteZip(sample(), { password }), 'not-encrypted');
  });
  it('rejects an encrypted file without an input password', async () => {
    const input = await protectedInput();
    await errorCode(rewriteZip(input), 'encrypted-entry');
  });
  it('rejects a kept directory flagged as encrypted without an input password', async () => {
    const plain = await archive([{ name: 'dir/', directory: true }, { name: 'dir/file.txt', text: 'x' }]);
    const input = await flagDirectoryEncrypted(plain, 'dir/');
    expect((await entriesOf(input))[0].encrypted).toBe(true);
    await errorCode(rewriteZip(input), 'encrypted-entry');
    const out = await rewriteZip(input, { keep: (name) => name !== 'dir/' });
    expect(out).toMatchObject({ encryptedCount: 1, kept: 1, removed: 1 });
    expect(await namesOf(out.blob)).toEqual(['dir/file.txt']);
  });
  it('does not mistake a callback exception for a password error', async () => {
    const sentinel = new Error('callback failed');
    await expect(rewriteZip(await protectedInput(), { password, onProgress: () => { throw sentinel; } })).rejects.toBe(sentinel);
    await expect(rewriteZip(await protectedInput(), { password, rename: () => { throw sentinel; } })).rejects.toBe(sentinel);
    await expect(rewriteZip(await protectedInput(), { password, keep: () => { throw sentinel; } })).rejects.toBe(sentinel);
  });
  it('closes the reader and discards partial output on callback failure', async () => {
    const readerClose = vi.spyOn(ZipReader.prototype, 'close');
    const writerClose = vi.spyOn(ZipWriter.prototype, 'close');
    const sentinel = new Error('stop');
    try {
      await expect(rewriteZip(sample(), { onProgress: () => { throw sentinel; } })).rejects.toBe(sentinel);
      expect(readerClose).toHaveBeenCalled();
      expect(writerClose).toHaveBeenCalled();
    } finally {
      readerClose.mockRestore();
      writerClose.mockRestore();
    }
  });
  it('preserves a callback error when cleanup also fails', async () => {
    const originalClose = ZipReader.prototype.close;
    const readerClose = vi.spyOn(ZipReader.prototype, 'close').mockImplementation(async function (this: ZipReader<BlobReader>) {
      await originalClose.call(this);
      throw new Error('cleanup failed');
    });
    const sentinel = new Error('callback failed');
    try {
      await expect(rewriteZip(sample(), { keep: () => { throw sentinel; } })).rejects.toBe(sentinel);
    } finally {
      readerClose.mockRestore();
    }
  });
  it.each(['keep', 'rename', 'onProgress'] as const)(
    'preserves a non-Error value thrown by %s when both close calls fail', async (callback) => {
      const readerClose = vi.spyOn(ZipReader.prototype, 'close').mockRejectedValue(new Error('reader cleanup failed'));
      const writerClose = vi.spyOn(ZipWriter.prototype, 'close').mockRejectedValue(new Error('writer cleanup failed'));
      const options = { [callback]: () => { throw undefined; } };
      try {
        await expect(rewriteZip(sample(), options)).rejects.toBeUndefined();
        expect(writerClose).toHaveBeenCalled();
        expect(readerClose).toHaveBeenCalled();
      } finally {
        readerClose.mockRestore();
        writerClose.mockRestore();
      }
    },
  );
  it('classifies an AES authentication-code failure as a wrong password', async () => {
    const input = await archive([{ name: 'secret.txt', text: 'secret', encrypted: true }], 'correct');
    const getEntries = ZipReader.prototype.getEntries;
    const getEntriesSpy = vi.spyOn(ZipReader.prototype, 'getEntries').mockImplementation(async function (this: ZipReader<BlobReader>) {
      const entries = await getEntries.call(this);
      const entry = entries[0];
      if (entry.directory) throw new Error('Expected a file entry');
      vi.spyOn(entry, 'getData').mockRejectedValue(new Error(ERR_INVALID_AUTHENTICATION_CODE));
      return entries;
    });
    try {
      await errorCode(rewriteZip(input, { password: 'wrong' }), 'wrong-password');
    } finally {
      getEntriesSpy.mockRestore();
    }
  });
  it('treats an empty input password as supplied, then rejects failed decryption', async () => {
    await errorCode(rewriteZip(await protectedInput(), { password: '' }), 'wrong-password');
  });
  it('accepts ZipCrypto input and re-encrypts it with AES-256', async () => {
    const input = await archive([{ name: 'secret.txt', text: 'secret', encrypted: true }], 'old', true);
    const out = await rewriteZip(input, { password: 'old', outPassword: 'new' });
    expect(await textOf(out.blob, 'secret.txt', 'new')).toBe('secret');
    const [entry] = await entriesOf(out.blob);
    expect(entry.encrypted).toBe(true);
    expect(entry.zipCrypto).toBe(false);
  });
  it('rejects a wrong ZipCrypto password even when its header check passes for stored data', async () => {
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add('stored.txt', new TextReader('stored secret'), {
      password: 'correct', zipCrypto: true, level: 0,
    });
    const input = asFile(await writer.close());
    const reader = new ZipReader(new BlobReader(input));
    let collision: string | undefined;
    try {
      const [entry] = await reader.getEntries();
      expect(entry.compressionMethod).toBe(0);
      if (entry.directory) throw new Error('Expected a file entry');
      for (let index = 0; index < 4096; index++) {
        const candidate = `wrong-${index}`;
        try {
          const data = await entry.getData(new BlobWriter(), {
            password: candidate, checkCrc32: false,
          });
          if (await data.text() !== 'stored secret') {
            collision = candidate;
            break;
          }
        } catch { /* Most passwords fail the ZipCrypto header check. */ }
      }
    } finally {
      await reader.close();
    }
    expect(collision).toBeDefined();
    await errorCode(rewriteZip(input, { password: collision }), 'wrong-password');
    const out = await rewriteZip(input, { password: 'correct' });
    expect(await textOf(out.blob, 'stored.txt')).toBe('stored secret');
  });
  it('does not claim an unused password was verified', async () => {
    const input = await archive([{ name: 'secret', text: 'x', encrypted: true }], 'pw');
    const out = await rewriteZip(input, { password: 'wrong', keep: () => false });
    expect(out.encryptedCount).toBe(1);
    expect(out.kept).toBe(0);
  });
});

describe('rewriteZip: encryption', () => {
  it('produces a valid .zip (PK magic bytes) with entries flagged as encrypted', async () => {
    const out = await rewriteZip(await archive([{ name: 'secret.txt', text: 'top secret' }]), { outPassword: 'hunter2' });
    expect(out.blob.type).toBe('application/zip');
    expect(new Uint8Array(await out.blob.slice(0, 2).arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b]));
    expect((await entriesOf(out.blob))[0].encrypted).toBe(true);
  });
  it('round-trips: decrypts with the correct password', async () => {
    const input = await archive([{ name: 'a.txt', text: 'AAA' }, { name: '日本語.txt', text: 'BBB' }]);
    const out = await rewriteZip(input, { outPassword: 'p@ss' });
    expect(await textOf(out.blob, 'a.txt', 'p@ss')).toBe('AAA');
    expect(await textOf(out.blob, '日本語.txt', 'p@ss')).toBe('BBB');
  });
  it('fails to decrypt with the wrong password', async () => {
    const out = await rewriteZip(await archive([{ name: 'secret.txt', text: 'top secret' }]), { outPassword: 'hunter2' });
    await expect(textOf(out.blob, 'secret.txt', 'wrong-password')).rejects.toThrow();
  });
  it('fails to decrypt with no password at all', async () => {
    const out = await rewriteZip(await archive([{ name: 'secret.txt', text: 'top secret' }]), { outPassword: 'hunter2' });
    await expect(textOf(out.blob, 'secret.txt')).rejects.toThrow();
  });
  it('keeps the UTF-8 filename flag so non-ASCII names survive on Windows', async () => {
    const out = await rewriteZip(await archive([{ name: '日本語.txt', text: 'x' }]), { outPassword: 'pw' });
    expect((await entriesOf(out.blob))[0].filenameUTF8).toBe(true);
  });
  it('rejects an empty password', async () => {
    await errorCode(rewriteZip(sample(), { outPassword: '' }), 'unsupported');
  });
  it('reports no progress for an empty input archive', async () => {
    const seen = vi.fn();
    const out = await rewriteZip(await archive([]), { outPassword: 'pw', onProgress: seen });
    expect(out).toMatchObject({ total: 0, kept: 0, removed: 0, renamed: 0 });
    expect(seen).not.toHaveBeenCalled();
    expect(await namesOf(out.blob)).toEqual([]);
  });
});
