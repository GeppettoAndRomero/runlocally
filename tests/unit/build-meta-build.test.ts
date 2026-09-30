import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashesFromHtml, generateHeaders } from '../../scripts/gen-headers.mjs';
import { LOCALES } from '../../src/i18n/locales';
import { PUBLIC_PAGES, pagePath } from '../../src/seo/url-model';

const expectedPages = LOCALES.flatMap(locale => PUBLIC_PAGES.map(page => pagePath(locale.code, page)));

const shaA = 'a'.repeat(40);
const shaB = 'b'.repeat(40);
const repository = process.cwd();

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

function snapshot(dir: string) {
  return new Map(files(dir).map(file => [relative(dir, file).split(sep).join('/'), readFileSync(file)]));
}

function withoutMeta(html: string) {
  return html.replace(/<meta name="build" content="[a-f\d]{40,64}">/g, '');
}

function revisions(sw: string) {
  return new Map([...sw.matchAll(/\{[^{}]*\}/g)].flatMap(match => {
    const url = match[0].match(/\burl\s*:\s*"([^"]+)"/)?.[1];
    const revision = match[0].match(/\brevision\s*:\s*"([^"]+)"/)?.[1];
    return url && revision ? [[url, revision] as const] : [];
  }));
}

function build(root: string, sha: string, notice = false) {
  execFileSync(process.execPath, [join(repository, 'node_modules/astro/astro.js'), 'build'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', GITHUB_SHA: sha, ...(notice ? { NOTICE_ANALYZE: '1' } : {}) },
    stdio: 'pipe', timeout: 60_000,
  });
}

function fixture(parent: string, name: string) {
  const root = join(parent, name);
  mkdirSync(root);
  for (const dir of ['src', 'scripts', 'public']) cpSync(join(repository, dir), join(root, dir), { recursive: true });
  for (const file of ['astro.config.mjs', 'package.json', 'tsconfig.json']) cpSync(join(repository, file), join(root, file));
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  mkdirSync(join(root, 'public/vendor/libarchive'), { recursive: true });
  for (const name of ['worker-bundle.js', 'libarchive.wasm']) {
    cpSync(join(repository, 'vendor/libarchive-lean', name), join(root, 'public/vendor/libarchive', name));
  }
  mkdirSync(join(root, 'docker'));
  return root;
}

describe('build hook ordering and update meaning', () => {
  it('keeps the worker, page revisions, assets and headers stable for a SHA-only change', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'build-meta-'));
    try {
      const root = fixture(parent, 'project');
      build(root, shaA);
      await generateHeaders(root);
      const first = join(parent, 'first-output');
      cpSync(join(root, 'dist'), first, { recursive: true });
      const firstCaddy = readFileSync(join(root, 'docker/headers.caddy'));
      build(root, shaB);
      await generateHeaders(root);

      const a = snapshot(first);
      const b = snapshot(join(root, 'dist'));
      expect([...a.keys()]).toEqual([...b.keys()]);
      const htmlPaths = [...a.keys()].filter(path => path.endsWith('.html'));
      expect(htmlPaths).toHaveLength(expectedPages.length);
      for (const path of htmlPaths) {
        const left = a.get(path)!.toString();
        const right = b.get(path)!.toString();
        expect(left).toContain(`<meta name="build" content="${shaA}">`);
        expect(right).toContain(`<meta name="build" content="${shaB}">`);
        expect(withoutMeta(left)).toBe(withoutMeta(right));
        expect(hashesFromHtml(left)).toEqual(hashesFromHtml(right));
      }
      for (const path of a.keys()) {
        if (!path.endsWith('.html')) expect(b.get(path)).toEqual(a.get(path));
      }
      const swA = a.get('sw.js')!.toString();
      const swB = b.get('sw.js')!.toString();
      expect(swB).toBe(swA);
      expect(revisions(swA)).toEqual(revisions(swB));
      for (const url of expectedPages) expect(revisions(swA).has(url), url).toBe(true);
      expect(a.get('_headers')).toEqual(b.get('_headers'));
      expect(firstCaddy).toEqual(readFileSync(join(root, 'docker/headers.caddy')));

      const source = join(root, 'src/pages/[...path].astro');
      writeFileSync(source, readFileSync(source, 'utf8').replace('<main>', '<main data-build-test="changed">'));
      build(root, shaA);
      const changedSw = readFileSync(join(root, 'dist/sw.js'), 'utf8');
      expect(changedSw).not.toBe(swA);
      expect(expectedPages.some(url => revisions(changedSw).get(url) !== revisions(swA).get(url))).toBe(true);
      build(root, shaA, true);
      const noticeHtml = readFileSync(join(root, '.notice-build/index.html'), 'utf8');
      expect(noticeHtml.match(/<meta name="build" content="[^"]+">/g)).toEqual([`<meta name="build" content="${shaA}">`]);
      expect(files(join(root, '.notice-build')).filter(path => path.endsWith('.html'))).toHaveLength(expectedPages.length);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 180_000);
});
