import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Archive as NodeArchive } from 'libarchive.js/dist/libarchive-node.mjs';
import { __setArchiveForTesting, openArchive } from '../../src/engine/archive/libarchive';
import { EngineError } from '../../src/engine/errors';
import { sniffArchiveKind } from '../../src/engine/sniff';

const sample = readFileSync(new URL('../fixtures/archive/sample.tar.gz', import.meta.url));
const contents = ['a nested note\n', 'hello from extract-rar-7z\n'];
const header = (flags = 0) => new Uint8Array([0x1f, 0x8b, 8, flags, 0, 0, 0, 0, 0, 3]);

describe('gzip signatures', () => {
  it.each([0, 1, 2, 4, 8, 16, 31])('accepts optional flags %i', flags => {
    const bytes = header(flags);
    const original = bytes.slice();
    expect(sniffArchiveKind(bytes)).toBe('gzip');
    expect(bytes).toEqual(original);
  });

  it.each(Array.from({ length: 10 }, (_, length) => length))('rejects %i header bytes', length => {
    expect(sniffArchiveKind(header().slice(0, length))).toBe('unknown');
  });

  it.each([0, 1, 7, 9, 255])('rejects compression method %i', method => {
    const bytes = header();
    bytes[2] = method;
    expect(sniffArchiveKind(bytes)).toBe('unknown');
  });

  it.each([0x20, 0x40, 0x80, 0xe0, 0xff])('rejects reserved flags %i', flags => {
    expect(sniffArchiveKind(header(flags))).toBe('unknown');
  });

  it.each([
    [[0x50, 0x4b, 3, 4], 'zip'], [[0x50, 0x4b, 5, 6], 'zip'],
    [[0x50, 0x4b, 7, 8], 'zip'],
    [[0x52, 0x61, 0x72, 0x21, 0x1a, 7, 0], 'rar'],
    [[0x52, 0x61, 0x72, 0x21, 0x1a, 7, 1, 0], 'rar'],
    [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], '7z'],
  ] as const)('preserves signature %j', (signature, kind) => {
    const bytes = new Uint8Array(263);
    bytes.set(signature);
    expect(sniffArchiveKind(bytes)).toBe(kind);
  });

  it.each([0, 0x20])('preserves tar precedence with terminator %i', terminator => {
    const bytes = new Uint8Array(263);
    bytes.set(header());
    bytes.set([0x75, 0x73, 0x74, 0x61, 0x72, terminator], 257);
    expect(sniffArchiveKind(bytes)).toBe('tar');
  });
});

describe('gzip archive route', () => {
  const closeSpies: MockInstance<() => Promise<void>>[] = [];
  beforeEach(() => {
    closeSpies.length = 0;
    __setArchiveForTesting(NodeArchive as any);
    const open = NodeArchive.open.bind(NodeArchive);
    vi.spyOn(NodeArchive, 'open').mockImplementation(async (file: File) => {
      const archive = await open(file);
      closeSpies.push(vi.spyOn(archive, 'close'));
      return archive;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ['sample.tar.gz', 'application/gzip'], ['x.bin', 'text/plain'], ['x', 'application/zip'],
  ])('lists and extracts %s regardless of metadata', async (name, type) => {
    const file = new File([sample], name, { type });
    expect(sniffArchiveKind(new Uint8Array(await file.slice(0, 263).arrayBuffer()))).toBe('gzip');
    const archive = await openArchive(file);
    try {
      expect(archive.entries).toEqual([
        { path: 'docs/notes.txt', size: 14 }, { path: 'readme.txt', size: 26 },
      ]);
      for (const [index, entry] of archive.entries.entries()) {
        expect(await (await archive.extractOne(entry.path)).text()).toBe(contents[index]);
      }
      expect(closeSpies[0]).not.toHaveBeenCalled();
    } finally { archive.close(); }
    expect(closeSpies[0]).toHaveBeenCalledOnce();

    const all = await openArchive(file);
    let completed = false;
    try {
      const progress = vi.fn();
      const files = await all.extractAll(progress);
      completed = true;
      expect(files.map(item => item.name)).toEqual(['notes.txt', 'readme.txt']);
      expect(await Promise.all(files.map(item => item.text()))).toEqual(contents);
      expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
      expect(closeSpies[1]).toHaveBeenCalledOnce();
    } finally { if (!completed) all.close(); }
    expect(Buffer.from(await file.arrayBuffer())).toEqual(sample);
  });

  it.each([
    ['text.gz', gzipSync('ordinary text\n')], ['empty.gz', gzipSync(Buffer.alloc(0))],
    ['empty.tar.gz', gzipSync(Buffer.alloc(1024))], ['truncated.tar.gz', sample.subarray(0, 12)],
  ])('rejects %s and closes the real archive', async (name, bytes) => {
    expect(sniffArchiveKind(bytes.subarray(0, 263))).toBe('gzip');
    const error = await openArchive(new File([bytes], name)).then(
      archive => { archive.close(); throw new Error('Expected rejection'); },
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({ code: 'unsupported' });
    expect(closeSpies[0]).toHaveBeenCalledOnce();
  });

  it('leaves closure to the caller after an individual extraction fails', async () => {
    const archive = await openArchive(new File([sample], 'sample.tar.gz'));
    try {
      await expect(archive.extractOne('missing.txt')).rejects.toMatchObject({ code: 'unsupported' });
      expect(closeSpies[0]).not.toHaveBeenCalled();
    } finally { archive.close(); }
    expect(closeSpies[0]).toHaveBeenCalledOnce();
  });
});
