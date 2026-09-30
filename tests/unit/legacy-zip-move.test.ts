import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import slugs from '../../legacy/slugs.json';
import { onRequest } from '../../functions/_middleware.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const tempDirs: string[] = [];
const oldZip = ['zip-viewer', 'unzip', 'remove-from-zip', 'zip-filename-fix'];
const publicPaths = [
  '/', '/en/', '/zip/', '/zip/view/', '/zip/extract/', '/zip/remove/',
  '/zip/fix-names/', '/en/zip/', '/en/zip/view/', '/en/zip/extract/',
  '/en/zip/remove/', '/en/zip/fix-names/',
];

async function visit(path: string, method = 'GET', upstream = new Response('upstream', { status: 202 })) {
  let calls = 0;
  const response = await onRequest({
    request: new Request(`https://runlocally.app${path}`, { method }),
    next: async () => { calls++; return upstream; },
  });
  return { response, calls };
}

async function expectGone(path: string, method: string) {
  const { response, calls } = await visit(path, method);
  expect(response.status, `${method} ${path}`).toBe(410);
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
  expect(response.headers.has('Location')).toBe(false);
  expect(await response.text()).toBe('');
  expect(calls).toBe(0);
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'legacy-zip-move-'));
  tempDirs.push(dir);
  for (const folder of ['scripts', 'functions', 'legacy']) await mkdir(join(dir, folder), { recursive: true });
  const script = join(dir, 'scripts/gen-legacy.mjs');
  const middleware = join(dir, 'functions/_middleware.js');
  const history = join(dir, 'legacy/slugs.json');
  await writeFile(script, await readFile(join(root, 'scripts/gen-legacy.mjs')));
  await writeFile(middleware, await readFile(join(root, 'functions/_middleware.js')));
  await writeFile(history, '["second-tool","first-tool"]\n');
  return { script, middleware, history };
}

function run(script: string, check = false) {
  return spawnSync(process.execPath, check ? [script, '--check'] : [script], { encoding: 'utf8' });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('old URL retirement', () => {
  it('keeps all historical slugs including the four old ZIP routes', () => {
    expect(slugs).toHaveLength(61);
    expect(new Set(slugs).size).toBe(61);
    expect(slugs).toEqual(expect.arrayContaining(oldZip));
    expect(slugs).not.toContain('zip');
  });

  it.each(slugs)('returns 410 for every form of %s', async slug => {
    for (const method of ['GET', 'HEAD']) {
      for (const path of [
        `/${slug}/`, `/${slug}`, `/${slug}/?from=old`,
        `/en/${slug}/`, `/en/${slug}`, `/en/${slug}/?from=old`,
        `/${slug}/ja/`, `/${slug}/zh/`, `/${slug}/sw.js`,
        `/${slug}/asset.js?version=1`, `/en/${slug}/ja/`,
        `/en/${slug}/sw.js`, `/en/${slug}/asset.js?version=1`,
      ]) await expectGone(path, method);
    }
  });

  it.each(publicPaths)('passes the public route %s to the next handler once', async path => {
    const upstream = new Response('downstream', { status: 203, headers: { 'X-Upstream': 'kept' } });
    const { response, calls } = await visit(path, 'GET', upstream);
    expect([response.status, await response.text(), calls]).toEqual([203, 'downstream', 1]);
    expect(response.headers.get('X-Upstream')).toBe('kept');
  });

  it.each(['/zip-viewer-other/', '/en/zip-viewer-other/', '/en/blog/', '/sw.js', '/manifest.webmanifest',
    '/robots.txt', '/sitemap-index.xml', '/SECURITY.md', '/_astro/app.js'])('passes %s by segment boundary', async path => {
    const { response, calls } = await visit(path);
    expect([response.status, calls]).toEqual([202, 1]);
  });
});

describe('legacy table isolation', () => {
  it('sorts only historical slugs and stays unchanged when an operation file appears', async () => {
    const { script, middleware } = await fixture();
    expect(run(script).status).toBe(0);
    const first = await readFile(middleware, 'utf8');
    expect(first).toContain('const LEGACY_SLUGS = [\n  "first-tool",\n  "second-tool"\n]');
    expect(first).not.toContain('OLD_JA_REDIRECT_PATHS');
    expect(first).not.toContain('NEW_SITE_SLUGS');
    await mkdir(join(script, '../../src/i18n'), { recursive: true });
    await writeFile(join(script, '../../src/i18n/ops.ts'), "export const OPS = [{ slug: 'renamed', available: false }];\n");
    expect(run(script, true).status).toBe(0);
    expect(run(script).status).toBe(0);
    expect(await readFile(middleware, 'utf8')).toBe(first);
  });

  it.each(['["first-tool","zip"]', '["first-tool","first-tool"]',
    '["Bad_Slug"]', '{}'])('rejects invalid history without writing: %s', async input => {
    const { script, middleware, history } = await fixture();
    await writeFile(history, input);
    const before = await readFile(middleware);
    expect(run(script).status).not.toBe(0);
    expect(run(script, true).status).not.toBe(0);
    expect(await readFile(middleware)).toEqual(before);
  });

  it.each(['missing', 'duplicate-start', 'duplicate-end'])('rejects %s markers without writing', async change => {
    const { script, middleware } = await fixture();
    const source = await readFile(middleware, 'utf8');
    const altered = change === 'missing'
      ? source.replace('// BEGIN GENERATED LEGACY TABLES', '')
      : change === 'duplicate-start'
        ? `// BEGIN GENERATED LEGACY TABLES\n${source}`
        : `${source}\n// END GENERATED LEGACY TABLES`;
    await writeFile(middleware, altered);
    expect(run(script).status).not.toBe(0);
    expect(run(script, true).status).not.toBe(0);
    expect(await readFile(middleware, 'utf8')).toBe(altered);
  });
});
