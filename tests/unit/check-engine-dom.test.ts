import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/check-engine-dom.sh');
const dirs: string[] = [];
const forbidden = ['document', '.createElement'].join('');
const forbiddenWindow = ['window', '.location'].join('');

function repo(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'check-engine-dom-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src/engine'), { recursive: true });
  copyFileSync(script, join(dir, 'scripts/check-engine-dom.sh'));
  writeFileSync(join(dir, 'src/engine/index.ts'), source);
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function run(dir: string) {
  return spawnSync('bash', ['scripts/check-engine-dom.sh'], {
    cwd: dir,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('check-engine-dom.sh', () => {
  it('passes without a match', () => {
    expect(run(repo('export const value = 1;\n')).status).toBe(0);
  });

  it('fails when a tracked engine file contains a DOM reference', () => {
    const result = run(repo(`const element = ${forbidden}('a');\n`));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('src/engine/index.ts:1:');
    expect(run(repo(`const path = ${forbiddenWindow};\n`)).status).toBe(1);
  });

  it('fails when git cannot scan the repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-engine-dom-norepo-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(script, join(dir, 'scripts/check-engine-dom.sh'));
    expect(run(dir).status).toBe(2);
  });
});
