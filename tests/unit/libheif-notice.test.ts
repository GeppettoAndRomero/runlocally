import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateNotice } from '../../scripts/gen-notice.mjs';

describe('libheif notices', () => {
  it('includes every recorded component, source and unchanged license body deterministically', async () => {
    const notice = await generateNotice();
    expect(await generateNotice()).toBe(notice);
    expect(notice).toBe(readFileSync('NOTICE.md', 'utf8'));
    const metadata = JSON.parse(readFileSync('vendor/libheif/components.json', 'utf8'));
    for (const component of metadata.components) {
      expect(notice).toContain(`### ${component.name} ${component.version}`);
      expect(notice).toContain(component.source);
      for (const file of component.licenseFiles) expect(notice).toContain(readFileSync(join('vendor/libheif/licenses', file), 'utf8'));
    }
    expect(notice).toContain('glue is not delivered to browsers');
    expect(notice).toContain('replacement procedure remains incomplete');
    expect(notice).toContain('wasm/libarchive-lean/Dockerfile');
  });
  it('rejects missing and empty libheif license bodies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'libheif-notice-'));
    try {
      for (const dir of ['vendor', 'node_modules/libarchive.js', 'node_modules/comlink']) cpSync(dir, join(root, dir), { recursive: true });
      const file = join(root, 'vendor/libheif/licenses/GPL-3.0.txt');
      writeFileSync(file, ' \n');
      await expect(generateNotice(root, [])).rejects.toThrow('Empty license text');
      rmSync(file);
      await expect(generateNotice(root, [])).rejects.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
