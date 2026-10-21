import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { prepareVendors } from './vendor-distribution.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export function vendorIntegration() {
  return {
    name: 'vendor-distribution',
    hooks: {
      'astro:config:setup': () => prepareVendors(root),
      'astro:build:done': ({ dir }) => {
        if (process.env.NOTICE_ANALYZE === '1') return;
        // Analyze first, check the generated notice, then include only the checked text.
        // Custom output builds must not overwrite another build's analysis directory.
        const temporary = resolve(fileURLToPath(dir)) !== resolve(root, 'dist');
        const analysisDir = temporary ? mkdtempSync(join(tmpdir(), 'vendor-notice-')) : join(root, '.notice-build');
        try {
          const result = spawnSync(process.execPath, [join(root, 'scripts/gen-notice.mjs'), '--check'], {
            cwd: root, stdio: 'inherit', env: { ...process.env, NOTICE_BUILD_DIR: analysisDir },
          });
          if (result.error) throw result.error;
          if (result.status !== 0) throw new Error('Distribution NOTICE check failed');
        } finally {
          if (temporary) rmSync(analysisDir, { recursive: true, force: true });
        }
        for (const file of ['NOTICE.md', 'LICENSE']) copyFileSync(join(root, file), join(fileURLToPath(dir), file));
      },
    },
  };
}
