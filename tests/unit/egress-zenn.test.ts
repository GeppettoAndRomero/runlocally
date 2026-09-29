import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanDist } from '../../scripts/check-egress.mjs';

describe('Zenn publication links in dist', () => {
  it('allows the approved profile only when present and rejects another profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'egress-zenn-'));
    const page = join(root, 'index.html');
    try {
      await writeFile(page, '<a href="https://runlocally.app/">Home</a>');
      expect(await scanDist(root)).toEqual([]);

      await writeFile(page, '<a href="https://zenn.dev/geppetto">Profile</a><a href="https://zenn.dev/geppetto/articles/example">Article</a>');
      expect(await scanDist(root)).toEqual([]);

      await writeFile(page, '<a href="https://zenn.dev/other">Other</a>');
      expect(await scanDist(root)).toEqual(['index.html:1: outside allowlist: https://zenn.dev/other']);

      await writeFile(page, '<a href="https://zenn.dev/geppetto-other">Other</a>');
      expect(await scanDist(root)).toEqual(['index.html:1: outside allowlist: https://zenn.dev/geppetto-other']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
