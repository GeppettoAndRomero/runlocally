import { describe, it, expect } from 'vitest';
import {
  configure,
  ZipWriter,
  ZipReader,
  BlobWriter,
  BlobReader,
  Uint8ArrayReader,
} from '@zip.js/zip.js';
import {
  planParts,
  buildPlan,
  splitZip,
  entryPackSize,
  partBaseName,
  humanSize,
  type PackEntry,
} from '../../src/engine/zip/split';
import { listEntries } from '../../src/engine/zip/list';

// No Web Workers in Node (vitest); compress inline.
configure({ useWebWorkers: false });

// ---------- planParts (pure bin-packing) ----------

const packs = (...sizes: number[]): PackEntry[] =>
  sizes.map((size, i) => ({ name: `e${i}`, size }));

function allIndices(parts: { indices: number[] }[]): number[] {
  return parts.flatMap((p) => p.indices).sort((a, b) => a - b);
}

describe('planParts', () => {
  it('packs entries so every part is within the target, covering all entries once', () => {
    const parts = planParts(packs(40, 40, 40, 50), 100, 0);
    expect(parts.length).toBe(2);
    for (const p of parts) {
      expect(p.oversize).toBe(false);
      expect(p.size).toBeLessThanOrEqual(100);
    }
    // union == all entries, no duplicates
    expect(allIndices(parts)).toEqual([0, 1, 2, 3]);
  });

  it('gives an entry larger than the target its own oversize part', () => {
    const parts = planParts(packs(150, 30), 100, 0);
    expect(allIndices(parts)).toEqual([0, 1]);
    const oversize = parts.filter((p) => p.oversize);
    expect(oversize).toHaveLength(1);
    expect(oversize[0].indices).toEqual([0]);
    expect(oversize[0].size).toBeGreaterThan(100);
    // the small entry is packed normally
    expect(parts.some((p) => !p.oversize && p.indices.includes(1))).toBe(true);
  });

  it('treats an entry exactly at the budget as fitting, not oversize', () => {
    const parts = planParts(packs(100), 100, 0);
    expect(parts).toHaveLength(1);
    expect(parts[0].oversize).toBe(false);
  });

  it('puts each entry in exactly one part for a larger set', () => {
    const parts = planParts(packs(30, 70, 20, 90, 10, 60, 40), 100, 0);
    const idx = allIndices(parts);
    expect(idx).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(idx).size).toBe(idx.length);
    for (const p of parts) expect(p.size).toBeLessThanOrEqual(100);
  });

  it('orders non-oversize parts before oversize ones', () => {
    const parts = planParts(packs(200, 20, 20), 100, 0);
    expect(parts[parts.length - 1].oversize).toBe(true);
  });
});

describe('entryPackSize / partBaseName / humanSize', () => {
  it('entryPackSize is at least the uncompressed size', () => {
    expect(entryPackSize(1000, 'a.bin')).toBeGreaterThan(1000);
  });
  it('partBaseName strips a trailing .zip', () => {
    expect(partBaseName('photos.zip')).toBe('photos');
    expect(partBaseName('photos.ZIP')).toBe('photos');
    expect(partBaseName('.zip')).toBe('archive');
  });
  it('humanSize formats bytes/KB/MB', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(1536)).toBe('1.5 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

// ---------- splitZip / listEntries / buildPlan (integration with @zip.js) ----------

function seeded(n: number, seed: number): Uint8Array {
  let a = (seed + 0x9e3779b9) >>> 0;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    b[i] = (t >>> 0) & 0xff;
  }
  return b;
}

interface Spec {
  name: string;
  size?: number;
  directory?: boolean;
}

async function makeZip(specs: Spec[]): Promise<File> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
  let s = 1;
  for (const spec of specs) {
    if (spec.directory) {
      await writer.add(spec.name, undefined, { directory: true });
    } else {
      // level 0 = STORED, so uncompressed size drives the plan predictably.
      await writer.add(spec.name, new Uint8ArrayReader(seeded(spec.size ?? 100, s++)), { level: 0 });
    }
  }
  const blob = await writer.close();
  return new File([blob], 'input.zip', { type: 'application/zip' });
}

async function fileNames(blob: Blob): Promise<string[]> {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  await reader.close();
  return entries.filter((e) => !e.directory).map((e) => e.filename);
}

describe('listEntries', () => {
  it('lists entries with sizes and throws on a non-zip', async () => {
    const zip = await makeZip([
      { name: 'a.bin', size: 1234 },
      { name: 'sub/日本語.bin', size: 2345 },
    ]);
    const entries = await listEntries(zip);
    expect(entries.map((e) => e.name).sort()).toEqual(['a.bin', 'sub/日本語.bin'].sort());
    expect(entries.find((e) => e.name === 'a.bin')!.size).toBe(1234);

    await expect(
      listEntries(new File([new Uint8Array([1, 2, 3, 4])], 'x.zip'))
    ).rejects.toThrow();
  });
});

describe('splitZip', () => {
  const TARGET = 8 * 1024; // 8 KB

  it('splits into independent parts, each ≤ target, together holding every entry', async () => {
    const specs: Spec[] = [
      { name: 'file-1.bin', size: 3000 },
      { name: 'file-2.bin', size: 3000 },
      { name: 'file-3.bin', size: 3000 },
      { name: 'file-4.bin', size: 3000 },
      { name: 'nested/日本語.bin', size: 3000 },
      { name: 'emptydir/', directory: true },
    ];
    const zip = await makeZip(specs);
    const original = (await fileNames(zip)).sort();

    const parts = await splitZip(zip, TARGET);
    expect(parts.length).toBeGreaterThanOrEqual(2);

    const seen: string[] = [];
    for (const part of parts) {
      expect(part.name).toMatch(/^input-part-\d{2,}\.zip$/);
      expect(part.blob.type).toBe('application/zip');
      expect(part.size).toBeLessThanOrEqual(TARGET);
      seen.push(...(await fileNames(part.blob)));
    }
    // Every original file appears exactly once across the parts.
    expect(seen.slice().sort()).toEqual(original);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('reports progress once per part', async () => {
    const zip = await makeZip([
      { name: 'a.bin', size: 3000 },
      { name: 'b.bin', size: 3000 },
      { name: 'c.bin', size: 3000 },
    ]);
    const seen: number[] = [];
    const parts = await splitZip(zip, TARGET, (p) => seen.push(p.part));
    expect(seen).toEqual(parts.map((_, i) => i + 1));
  });

  it('puts a single entry larger than the target in its own oversize part', async () => {
    const zip = await makeZip([
      { name: 'big.bin', size: 20 * 1024 }, // > 8 KB target
      { name: 'small.bin', size: 1000 },
    ]);
    const parts = await splitZip(zip, TARGET);
    const oversize = parts.filter((p) => p.oversize);
    expect(oversize).toHaveLength(1);
    expect(await fileNames(oversize[0].blob)).toEqual(['big.bin']);
    // union still complete
    const seen: string[] = [];
    for (const p of parts) seen.push(...(await fileNames(p.blob)));
    expect(seen.sort()).toEqual(['big.bin', 'small.bin']);
  });

  it('rejects an invalid zip and an empty zip', async () => {
    await expect(
      splitZip(new File([new Uint8Array([0, 1, 2, 3])], 'bad.zip'), TARGET)
    ).rejects.toThrow();

    const empty = await makeZip([]);
    await expect(splitZip(empty, TARGET)).rejects.toThrow();
  });

  it('buildPlan agrees with the number of parts splitZip produces', async () => {
    const specs: Spec[] = [
      { name: '1.bin', size: 3000 },
      { name: '2.bin', size: 3000 },
      { name: '3.bin', size: 3000 },
      { name: '4.bin', size: 3000 },
    ];
    const zip = await makeZip(specs);
    const meta = await listEntries(zip);
    const plan = buildPlan(meta, TARGET);
    const parts = await splitZip(zip, TARGET);
    expect(parts.length).toBe(plan.length);
  });
});

describe('splitZip failures', () => {
  it('classifies an empty archive and malformed central directory', async () => {
    await expect(splitZip(await makeZip([]), 8192)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(splitZip(new File(['invalid'], 'bad.zip'), 8192)).rejects.toMatchObject({ code: 'bad-central' });
  });

  it('rejects an encrypted entry and closes its reader', async () => {
    const { vi } = await import('vitest');
    const close = vi.spyOn(ZipReader.prototype, 'close');
    const writer = new ZipWriter(new BlobWriter('application/zip'), { password: 'secret', encryptionStrength: 3 });
    await writer.add('secret.txt', new Uint8ArrayReader(new Uint8Array([1, 2, 3])));
    const zip = new File([await writer.close()], 'encrypted.zip');
    try {
      await expect(splitZip(zip, 8192)).rejects.toMatchObject({ code: 'encrypted-entry' });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });

  it('preserves a progress failure and closes the reader', async () => {
    const { vi } = await import('vitest');
    const zip = await makeZip([{ name: 'a.bin', size: 128 }]);
    const close = vi.spyOn(ZipReader.prototype, 'close');
    const failure = new Error('progress failed');
    try {
      await expect(splitZip(zip, 8192, () => { throw failure; })).rejects.toBe(failure);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });
});

describe('splitZip interrupted output', () => {
  it('preserves a writer failure and closes the reader and writer', async () => {
    const { vi } = await import('vitest');
    const zip = await makeZip([{ name: 'a.bin', size: 128 }]);
    const failure = new Error('write failed');
    const add = vi.spyOn(ZipWriter.prototype, 'add').mockRejectedValueOnce(failure);
    const writerClose = vi.spyOn(ZipWriter.prototype, 'close');
    const readerClose = vi.spyOn(ZipReader.prototype, 'close');
    try {
      await expect(splitZip(zip, 8192)).rejects.toBe(failure);
      expect(writerClose).toHaveBeenCalledOnce();
      expect(readerClose).toHaveBeenCalledOnce();
    } finally {
      add.mockRestore();
      writerClose.mockRestore();
      readerClose.mockRestore();
    }
  });
});

describe('splitZip metadata', () => {
  it('preserves an explicit directory and entry dates and counts only files', async () => {
    const date = new Date('2020-01-02T03:04:06Z');
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add('empty/', undefined, { directory: true, lastModDate: date });
    await writer.add('file.txt', new Uint8ArrayReader(new Uint8Array([1])), { lastModDate: date });
    const zip = new File([await writer.close()], 'dated.zip');
    const parts = await splitZip(zip, 8192);
    expect(parts).toHaveLength(1);
    expect(parts[0].count).toBe(1);
    const reader = new ZipReader(new BlobReader(parts[0].blob));
    try {
      const entries = await reader.getEntries();
      expect(entries.map((entry) => entry.filename)).toEqual(['empty/', 'file.txt']);
      expect(entries[0].directory).toBe(true);
      expect(entries.map((entry) => entry.lastModDate?.getTime())).toEqual([date.getTime(), date.getTime()]);
    } finally {
      await reader.close();
    }
  });
});
