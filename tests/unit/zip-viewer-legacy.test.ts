import { describe, it, expect } from 'vitest';
import { configure } from '@zip.js/zip.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listZip } from '@/engine/zip/viewer-legacy';

configure({ useWebWorkers: false });
const buf = readFileSync(fileURLToPath(new URL('../fixtures/zip/viewer-sample.zip', import.meta.url)));
const zipFile = () => new File([buf], 'sample.zip', { type: 'application/zip' });

describe('listZip', () => {
  it('lists entries with their names', async () => {
    const names = (await listZip(zipFile())).map((e) => e.name);
    expect(names).toContain('readme.txt');
    expect(names).toContain('日本語フォルダ/メモ.txt');
  });

  it('marks UTF-8 filenames and reports size + non-encrypted', async () => {
    const entries = await listZip(zipFile());
    const readme = entries.find((e) => e.name === 'readme.txt')!;
    expect(readme.size).toBeGreaterThan(0);
    expect(readme.encrypted).toBe(false);
    expect(readme.utf8).toBe(true);
    expect(readme.date instanceof Date || readme.date === undefined).toBe(true);
  });

  it('throws on a non-zip blob', async () => {
    await expect(listZip(new File([new Uint8Array([1, 2, 3, 4])], 'x.zip'))).rejects.toThrow();
  });
});
