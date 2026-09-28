import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/check-leaks.sh');
const roots: string[] = [];
const general = ['sample', 'gmail.com'].join('@');
const personal = 'private-marker';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'leak-notice-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'scripts'));
  copyFileSync(script, join(root, 'scripts/check-leaks.sh'));
  mkdirSync(join(root, 'vendor/libarchive-lean/licenses'), { recursive: true });
  writeFileSync(join(root, 'NOTICE.md'), general);
  writeFileSync(join(root, 'vendor/libarchive-lean/licenses/LICENSE'), general);
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}
function run(root: string, cached: boolean, pattern = '') {
  return spawnSync('bash', ['scripts/check-leaks.sh', ...(cached ? ['--cached'] : [])], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEAK_PATTERNS: pattern, LEAK_PATTERNS_REQUIRED: '0' },
  });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const cached of [false, true]) {
  it(`excludes third-party license bodies only from general patterns (${cached ? 'index' : 'worktree'})`, () => {
    const root = fixture();
    expect(run(root, cached).status).toBe(0);
    writeFileSync(join(root, 'NOTICE.md'), general + '\n' + personal);
    writeFileSync(join(root, 'vendor/libarchive-lean/licenses/LICENSE'), general + '\n' + personal);
    if (cached) execFileSync('git', ['add', '-A'], { cwd: root });
    const hit = run(root, cached, personal);
    expect(hit.status).toBe(1);
    expect(hit.stdout).toContain('NOTICE.md:');
    expect(hit.stdout).toContain('licenses/LICENSE:');
  });
}
