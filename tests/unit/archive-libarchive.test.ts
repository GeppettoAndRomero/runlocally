import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Archive as NodeArchive } from 'libarchive.js/dist/libarchive-node.mjs';
import { openArchive, baseName, __setArchiveForTesting } from './archive-port/archiveEngine';

beforeAll(() => {
  __setArchiveForTesting(NodeArchive as any);
});

const fixture = (name: string) =>
  new File(
    [readFileSync(fileURLToPath(new URL(`../fixtures/archive/${name}`, import.meta.url)))],
    name,
  );

describe('baseName', () => {
  it('returns the last path segment', () => {
    expect(baseName('docs/sub/deep.txt')).toBe('deep.txt');
    expect(baseName('readme.txt')).toBe('readme.txt');
  });
});

describe('openArchive — TAR', () => {
  it('lists every file with its full path and size', async () => {
    const archive = await openArchive(fixture('sample.tar'));
    try {
      const paths = archive.entries.map((e) => e.path);
      expect(paths).toEqual(['docs/notes.txt', 'readme.txt']);
      const readme = archive.entries.find((e) => e.path === 'readme.txt')!;
      expect(readme.size).toBe(26);
    } finally {
      archive.close();
    }
  });

  it('extracts a single file with the exact original bytes', async () => {
    const archive = await openArchive(fixture('sample.tar'));
    try {
      const file = await archive.extractOne('readme.txt');
      expect(await file.text()).toBe('hello from extract-rar-7z\n');
    } finally {
      archive.close();
    }
  });

  it('extracts a nested file with the exact original bytes', async () => {
    const archive = await openArchive(fixture('sample.tar'));
    try {
      const file = await archive.extractOne('docs/notes.txt');
      expect(await file.text()).toBe('a nested note\n');
    } finally {
      archive.close();
    }
  });
});

describe('openArchive — TAR.GZ', () => {
  it('lists and extracts through the gzip filter transparently', async () => {
    const archive = await openArchive(fixture('sample.tar.gz'));
    try {
      expect(archive.entries.map((e) => e.path).sort()).toEqual(['docs/notes.txt', 'readme.txt']);
      const file = await archive.extractOne('readme.txt');
      expect(await file.text()).toBe('hello from extract-rar-7z\n');
    } finally {
      archive.close();
    }
  });
});

describe('openArchive — 7z', () => {
  it('lists and extracts with the exact original bytes', async () => {
    const archive = await openArchive(fixture('sample.7z'));
    try {
      expect(archive.entries.map((e) => e.path).sort()).toEqual(['docs/notes.txt', 'readme.txt']);
      const file = await archive.extractOne('docs/notes.txt');
      expect(await file.text()).toBe('a nested note\n');
    } finally {
      archive.close();
    }
  });
});

describe('openArchive — RAR5', () => {
  it('lists and extracts a real RAR5 archive with the exact original bytes', async () => {
    const archive = await openArchive(fixture('rar5-helloworld.rar'));
    try {
      expect(archive.entries).toEqual([{ path: 'helloworld.txt', size: 29 }]);
      const file = await archive.extractOne('helloworld.txt');
      expect(await file.text()).toBe('hello libarchive test suite!\n');
    } finally {
      archive.close();
    }
  });
});

describe('openArchive — RAR4 (nested folder)', () => {
  it('lists the root and nested files (directories/symlinks are not listed)', async () => {
    const archive = await openArchive(fixture('rar4-sample.rar'));
    try {
      const paths = archive.entries.map((e) => e.path).sort();
      expect(paths).toEqual(['test.txt', 'testdir/test.txt']);
    } finally {
      archive.close();
    }
  });

  it('extracts the nested file with the exact original bytes', async () => {
    const archive = await openArchive(fixture('rar4-sample.rar'));
    try {
      const file = await archive.extractOne('testdir/test.txt');
      expect(await file.text()).toBe('test text document\r\n');
    } finally {
      archive.close();
    }
  });
});

describe('openArchive — encrypted archive', () => {
  it('throws errArchiveEncrypted instead of listing or extracting', async () => {
    await expect(openArchive(fixture('rar-encrypted.rar'))).rejects.toMatchObject({
      code: 'errArchiveEncrypted',
    });
  });
});

describe('openArchive — empty archive', () => {
  it('throws errEmpty for a valid but empty TAR (0 entries)', async () => {
    await expect(openArchive(fixture('empty.tar'))).rejects.toMatchObject({ code: 'errEmpty' });
  });
});

describe('openArchive — unparseable input', () => {
  it('throws errEmpty for garbage bytes with no recognizable archive format', async () => {
    // libarchive.js's archive_open() does not distinguish "unrecognized format"
    // from "genuinely empty archive" (see the temporary engine implementation) — both
    // are a successful open with zero listable entries, so this is the accurate,
    // honestly-scoped result rather than a distinct "invalid" error.
    await expect(
      openArchive(new File([new Uint8Array([1, 2, 3, 4])], 'x.rar')),
    ).rejects.toMatchObject({ code: 'errEmpty' });
  });
});

describe('openArchive(...).extractOne — invalid path', () => {
  it('throws errInvalidArchive for a path that is not in the listing', async () => {
    const archive = await openArchive(fixture('sample.tar'));
    try {
      await expect(archive.extractOne('does/not/exist.txt')).rejects.toMatchObject({
        code: 'errInvalidArchive',
      });
    } finally {
      archive.close();
    }
  });
});
