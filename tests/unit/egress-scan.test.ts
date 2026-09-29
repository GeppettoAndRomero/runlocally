import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanDist } from '../../scripts/check-egress.mjs';

describe('dist URL scan', () => {
  it('rejects an empty dist and catches minified JS URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'egress-'));
    try {
      await expect(scanDist(root)).rejects.toThrow(/No HTML/);
      await mkdir(join(root, '_astro'));
      await writeFile(join(root, 'index.html'), '<a href="https://schema.org/Thing">ok</a>');
      await writeFile(join(root, '_astro', 'app.min.js'), 'const x="https://unexpected.test/send";');
      expect(await scanDist(root)).toEqual(['_astro/app.min.js:1: outside allowlist: https://unexpected.test/send']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
