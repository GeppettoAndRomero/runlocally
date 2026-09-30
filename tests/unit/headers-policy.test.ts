import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { caddyHeaders, headerModel, pagesHeaders } from '../../scripts/gen-headers.mjs';
import { pagePath } from '../../src/seo/page';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function model() {
  const root = await mkdtemp(join(tmpdir(), 'headers-policy-'));
  roots.push(root);
  await Promise.all(['dist', 'public'].map((dir) => mkdir(join(root, dir))));
  await writeFile(join(root, 'dist/index.html'), '<script>start()</script>');
  return headerModel(root);
}
type Rule = { path: string; headers: Record<string, string> };
function matches(pattern: string, path: string) {
  return pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
}
function effective(rules: Rule[], path: string) {
  const values: Record<string, string[]> = {};
  for (const rule of rules.filter((rule) => matches(rule.path, path))) {
    for (const [name, value] of Object.entries(rule.headers)) (values[name] ??= []).push(value);
  }
  return values;
}
function parsePages(source: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of source.trimEnd().split('\n')) {
    if (line.startsWith('/')) rules.push({ path: line, headers: {} });
    else if (line.startsWith('  ')) {
      const [, name, value] = /^ {2}([^:]+): (.*)$/.exec(line)!;
      rules.at(-1)!.headers[name] = value;
    }
  }
  return rules;
}
function parseCaddy(source: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of source.split('\n')) {
    if (line.startsWith('header ')) rules.push({ path: /^header(?: (\/\S+))? \{$/.exec(line)![1] ?? '/*', headers: {} });
    else if (line === 'header {') rules.push({ path: '/*', headers: {} });
    else if (line.startsWith('  ')) {
      const [, name, value] = /^ {2}(\S+) (".*")$/.exec(line)!;
      rules.at(-1)!.headers[name] = JSON.parse(value);
    }
  }
  return rules;
}

describe('effective policy', () => {
  it('matches Pages and Caddy for HTML, assets, vendor and the new worker path', async () => {
    const rules = await model();
    const pages = parsePages(pagesHeaders(rules));
    const caddy = parseCaddy(caddyHeaders(rules));
    const topPath = pagePath('ja', 'top');
    for (const path of [topPath, pagePath('en', 'browse'), '/_astro/app.js', '/vendor/libarchive/libarchive.wasm', '/sw.js']) {
      expect(effective(caddy, path)).toEqual(effective(pages, path));
      const cache = effective(pages, path)['Cache-Control'];
      expect(cache?.length ?? 0).toBeLessThanOrEqual(1);
      if (path === '/sw.js') expect(cache).toEqual(['no-cache']);
      else if (path.startsWith('/_astro/')) expect(cache).toEqual(['public, max-age=31536000, immutable']);
      else if (path.startsWith('/vendor/')) expect(cache).toEqual(['no-cache']);
      else expect(cache).toBeUndefined();
    }
    const csp = effective(pages, topPath)['Content-Security-Policy'][0];
    expect(csp).toContain(`'sha256-${createHash('sha256').update('start()').digest('base64')}'`);
    expect(csp).toContain("img-src 'self' blob: data:");
    for (const directive of ['script-src', 'worker-src', 'connect-src']) {
      expect(csp.split('; ').find((part) => part.startsWith(directive))).not.toContain('blob:');
    }
    expect(csp).toContain("frame-ancestors 'none'");
    expect(effective(pages, topPath)['X-Frame-Options']).toEqual(['DENY']);
    expect(effective(pages, topPath)['X-Content-Type-Options']).toEqual(['nosniff']);
  });

  it('keeps hashed Astro assets immutable but revalidates fixed vendor worker and WASM URLs', async () => {
    const rules = await model();
    for (const parsed of [parsePages(pagesHeaders(rules)), parseCaddy(caddyHeaders(rules))]) {
      expect(effective(parsed, '/_astro/app.abc123.js')['Cache-Control']).toEqual(['public, max-age=31536000, immutable']);
      for (const path of ['/vendor/libarchive/worker-bundle.js', '/vendor/libarchive/libarchive.wasm']) {
        expect(effective(parsed, path)['Cache-Control']).toEqual(['no-cache']);
      }
    }
  });

  it('rejects CSP lines over the Pages limit without dropping hashes', async () => {
    const rules = await model();
    (rules[0].headers as Record<string, string>)['Content-Security-Policy'] += ' x'.repeat(1000);
    expect(() => pagesHeaders(rules)).toThrow('exceeds 2000');
  });
});
