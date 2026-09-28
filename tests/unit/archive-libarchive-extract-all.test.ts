import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Archive as NodeArchive } from 'libarchive.js/dist/libarchive-node.mjs';
import { __setArchiveForTesting, openArchive } from '../../src/engine/archive/libarchive';

// Full extraction against the real lean WASM: every listed file must come back with the same
// name and bytes as a single extraction, with one progress report per file.
beforeAll(() => {
  __setArchiveForTesting(NodeArchive as any);
});

const fixture = (name: string) =>
  new File([readFileSync(fileURLToPath(new URL(`../fixtures/archive/${name}`, import.meta.url)))], name);

async function singleExtractions(name: string) {
  const archive = await openArchive(fixture(name));
  try {
    const out = new Map<string, string>();
    for (const entry of archive.entries) out.set(entry.path, await (await archive.extractOne(entry.path)).text());
    return { paths: archive.entries.map((e) => e.path), contents: out };
  } finally {
    archive.close();
  }
}

describe.each(['sample.tar', 'sample.tar.gz', 'sample.7z', 'rar4-sample.rar', 'rar5-helloworld.rar'])(
  'extractAll on %s',
  (name) => {
    it('returns every listed file with the same bytes as single extraction and reports progress', async () => {
      const expected = await singleExtractions(name);
      const archive = await openArchive(fixture(name));
      const progress: Array<[number, number]> = [];
      const files = await archive.extractAll((done, total) => progress.push([done, total]));
      expect(files.length).toBe(expected.paths.length);
      expect(files.length).toBeGreaterThan(0);
      // Files come back in listing order, named by the last path segment.
      for (const [i, file] of files.entries()) {
        const path = expected.paths[i];
        expect(file.name).toBe(path.split('/').pop());
        expect(await file.text()).toBe(expected.contents.get(path));
      }
      expect(progress).toEqual(expected.paths.map((_, i) => [i + 1, expected.paths.length]));
    });
  },
);
