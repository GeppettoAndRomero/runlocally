import { describe, expect, it, vi } from 'vitest';
import { resolveBuildSha } from '../../scripts/build-meta.mjs';

const sha = 'a'.repeat(40);
const sha256 = 'b'.repeat(64);

describe('build SHA resolution', () => {
  it('prefers a trimmed full environment SHA without calling git', () => {
    const git = vi.fn();
    expect(resolveBuildSha({ env: { GITHUB_SHA: `  ${sha256}\n` }, git })).toBe(sha256);
    expect(git).not.toHaveBeenCalled();
  });

  it('falls back to git in the project root', () => {
    const git = vi.fn().mockReturnValue(` ${sha}\n`);
    expect(resolveBuildSha({ env: { GITHUB_SHA: '  ' }, root: '/project', git })).toBe(sha);
    expect(git).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], {
      cwd: '/project', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('uses dev without git locally and fails in CI', () => {
    const git = vi.fn().mockImplementation(() => { throw new Error('git unavailable'); });
    expect(resolveBuildSha({ env: {}, git })).toBe('dev');
    expect(() => resolveBuildSha({ env: { CI: 'true' }, git })).toThrow('Commit SHA is required in CI');
  });

  it('rejects malformed values instead of shortening or accepting them', () => {
    const git = vi.fn().mockReturnValue('not-a-sha');
    for (const value of ['xyz', sha.slice(0, 7), `${sha}<`]) {
      expect(() => resolveBuildSha({ env: { GITHUB_SHA: value }, git })).toThrow('Invalid commit SHA');
    }
    expect(() => resolveBuildSha({ env: {}, git })).toThrow('Invalid commit SHA from git');
  });
});
