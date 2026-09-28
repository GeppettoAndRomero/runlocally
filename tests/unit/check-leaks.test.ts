import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Runs the real script in a throwaway repository with the system bash (3.2 on macOS, 5.x on
// Linux CI), so a fail-open regression in either shell turns this suite red.
const script = join(process.cwd(), 'scripts/check-leaks.sh');
const dirs: string[] = [];
// Fixture strings are assembled at runtime so this file does not trip the scan it tests.
const HOME_PATH = ['/Us', 'ers/someone/x'].join('');
const GMAIL = ['someone', 'gmail.com'].join('@');
const ENV_FILE = ['.e', 'nv.local'].join('');

function repo(files: Record<string, string>, stage = true) {
  const dir = mkdtempSync(join(tmpdir(), 'check-leaks-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(script, join(dir, 'scripts/check-leaks.sh'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  if (stage) git('add', '-A');
  return dir;
}
function run(dir: string, args: string[] = [], env: Record<string, string> = {}) {
  const clean = { ...process.env, LEAK_PATTERNS: '', LEAK_PATTERNS_REQUIRED: '0', ...env };
  return spawnSync('bash', ['scripts/check-leaks.sh', ...args], { cwd: dir, env: clean, encoding: 'utf8' });
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('check-leaks.sh', () => {
  it('passes a clean tree and fails on a general pattern', () => {
    expect(run(repo({ 'a.txt': 'nothing here\n' })).status).toBe(0);
    const hit = run(repo({ 'a.txt': `path ${HOME_PATH}\n` }));
    expect(hit.status).toBe(1);
    expect(hit.stdout).toContain('a.txt:1:');
  });

  it('checks the staged index with --cached even after the working tree is cleaned', () => {
    const dir = repo({ 'a.txt': `mail me at ${GMAIL}\n` });
    writeFileSync(join(dir, 'a.txt'), 'clean\n');
    expect(run(dir).status).toBe(0);
    expect(run(dir, ['--cached']).status).toBe(1);
  });

  it('reads newline-separated personal patterns, keeps alternations intact and never prints them', () => {
    const dir = repo({ 'a.txt': 'secret-codename-zeta\n' });
    const result = run(dir, [], { LEAK_PATTERNS: '(alpha|codename-zeta)\nother-term' });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain('other-term');
    expect(run(repo({ 'b.txt': 'fine\n', '.leak-patterns.local': 'codename-zeta\n' }, false)).status).toBe(0);
  });

  it('flags an env-file name but not process.env in code', () => {
    expect(run(repo({ 'a.txt': `copy ${ENV_FILE} first\n` })).status).toBe(1);
    expect(run(repo({ 'a.ts': 'const x = process.env.HOME;\n' })).status).toBe(0);
  });

  it('fails when personal patterns are required but missing', () => {
    expect(run(repo({ 'a.txt': 'fine\n' }), [], { LEAK_PATTERNS_REQUIRED: '1' }).status).toBe(2);
  });

  it('fails closed when git grep errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-leaks-norepo-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(script, join(dir, 'scripts/check-leaks.sh'));
    expect(run(dir).status).toBe(2);
  });
});
