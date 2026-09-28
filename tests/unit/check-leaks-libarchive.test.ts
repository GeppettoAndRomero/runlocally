import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/check-leaks.sh');
const roots: string[] = [];
const marker = ['/Us', 'ers/example/private'].join('');
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'check-leaks-vendor-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'vendor/libarchive-lean'), { recursive: true });
  copyFileSync(script, join(root, 'scripts/check-leaks.sh'));
  writeFileSync(join(root, 'vendor/libarchive-lean/generated.js'), marker + '\n');
  writeFileSync(join(root, 'outside.txt'), 'clean\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}
function run(root: string, cached: boolean) {
  return spawnSync('bash', ['scripts/check-leaks.sh', ...(cached ? ['--cached'] : [])], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEAK_PATTERNS: '', LEAK_PATTERNS_REQUIRED: '0' },
  });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('libarchive leak exclusion', () => {
  for (const cached of [false, true]) {
    it(`excludes only the vendored directory (${cached ? 'index' : 'working tree'})`, () => {
      const root = setup();
      expect(run(root, cached).status).toBe(0);
      writeFileSync(join(root, 'outside.txt'), marker + '\n');
      if (cached) execFileSync('git', ['add', 'outside.txt'], { cwd: root });
      const hit = run(root, cached);
      expect(hit.status).toBe(1);
      expect(hit.stdout).toContain('outside.txt:1:');
    });
  }
});
