import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/PWA.md names files, npm scripts and header values. Keep those statements true: each one is
// checked against the repository, so a rename or a policy change fails here until the page is updated.
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const doc = read('docs/PWA.md');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('docs/PWA.md stays true', () => {
  it('names only files that exist', () => {
    const named = [...doc.matchAll(/`([\w./@-]+\.(?:mjs|js|ts|json|webmanifest|svg|md|caddy))`/g)].map(match => match[1]);
    expect(named.length).toBeGreaterThan(8);
    for (const path of new Set(named)) {
      // Built output and retired URLs are addresses that are served (or refused), not files in the repository.
      if (/^\/(?:<slug>|[\w-]+)\/sw\.js$|^\/?sw\.js$/.test(path)) continue;
      // Files the reader creates while following the manual steps.
      if (path.startsWith('dist/legacy-test/')) continue;
      // The served libarchive files are copied at build time from the committed vendor directory.
      const served = path.replace(/^\/vendor\/libarchive\//, 'vendor/libarchive-lean/');
      const candidates = [path, `docs/${path}`, served];
      expect(candidates.some(candidate => existsSync(join(root, candidate))), path).toBe(true);
    }
  });

  it('names only npm scripts that exist, and CI runs the freshness checks', () => {
    const scripts = [...doc.matchAll(/`npm run ([\w:.-]+)`/g)].map(match => match[1]);
    expect(scripts).toEqual(expect.arrayContaining(['legacy:check', 'legacy:generate', 'headers:check', 'build']));
    for (const script of new Set(scripts)) expect(pkg.scripts[script], script).toBeTruthy();
    for (const check of ['legacy:check', 'headers:check', 'notice:check']) expect(pkg.scripts.ci, check).toContain(`npm run ${check}`);
  });

  it('describes the cache policy and CSP that the generator produces', () => {
    const generator = read('scripts/gen-headers.mjs');
    expect(generator).toMatch(/'\/_astro\/\*'[^\n]*immutable/);
    expect(generator).toMatch(/'\/vendor\/\*'[^\n]*no-cache/);
    expect(generator).toMatch(/'\/sw\.js'[^\n]*no-cache/);
    expect(generator).toContain("worker-src 'self'");
    expect(generator).toContain("'wasm-unsafe-eval'");
    expect(generator).not.toMatch(/(script|worker)-src[^\n]*blob:/);
    expect(doc).toMatch(/`\/_astro\/\*` is `immutable`/);
    expect(doc).toMatch(/`\/vendor\/\*` is `no-cache`/);
    expect(doc).toMatch(/`\/sw\.js` is `no-cache`/);
    expect(existsSync(join(root, 'public/_headers'))).toBe(false);
  });

  it('describes the worker configuration and manifest that the build uses', () => {
    const config = read('astro.config.mjs');
    expect(config).toContain("strategies: 'generateSW'");
    expect(config).toContain('navigateFallback: null');
    expect(config).toContain('skipWaiting: false');
    expect(config).not.toContain('runtimeCaching');
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, string>;
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('states the behaviors that the code really has', () => {
    // Cache period of a 410, from the middleware.
    const middleware = read('functions/_middleware.js');
    const gone = middleware.match(/status: 410,\s*headers: \{ 'Cache-Control': '([^']+)'/);
    expect(gone?.[1]).toBe('public, max-age=3600');
    expect(doc).toContain(`Cache-Control: ${gone![1]}`);
    // Manifest fields the page relies on, quoted from the file, not from memory.
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { id: string; icons: Array<{ sizes: string; purpose: string }> };
    expect(manifest.id).toBe('/');
    expect(manifest.icons.map(icon => icon.sizes).sort()).toEqual(['192x192', '512x512']);
    expect(manifest.icons.every(icon => icon.purpose.includes('maskable'))).toBe(true);
    expect(doc).toMatch(/192 and 512 PNGs \(maskable\)/);
    // The update button waits for "no result listed", not merely "nothing unsaved".
    const controller = read('src/app/Workbench.tsx');
    expect(controller).toMatch(/!session\.source && session\.results\.length === 0/);
    expect(doc).toContain('Saving a result does not clear it from the list, so press Reset first');
    expect(doc).not.toMatch(/no unsaved result/);
    // The retired Lighthouse PWA category must not be recommended anywhere public.
    for (const file of ['README.md', 'docs/PRINCIPLES.md']) expect(read(file), file).not.toMatch(/Lighthouse PWA/);
    expect(doc).toContain('Lighthouse no longer has a PWA category');
  });

  it('quotes the values that the generator and manifest really contain', () => {
    const generator = read('scripts/gen-headers.mjs');
    // "immutable for a year": the period is read from the generator, so 1 day or 2 years would fail here.
    const seconds = Number(generator.match(/'\/_astro\/\*'[^\n]*max-age=(\d+), immutable/)?.[1]);
    expect(seconds).toBe(365 * 24 * 60 * 60);
    expect(doc).toMatch(/`\/_astro\/\*` is `immutable` for a year/);
    // The manifest display mode and the header names listed in the page.
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { display: string; start_url: string; scope: string };
    expect(doc).toContain(`\`display: ${manifest.display}\``);
    for (const header of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      expect(generator, header).toContain(header);
      expect(doc, header).toContain(`\`${header}\``);
    }
    expect(generator).toContain("frame-ancestors 'none'");
    expect(doc).toContain("`frame-ancestors 'none'`");
    // Each CSP directive the page describes is in the generated policy, and the page still describes them.
    for (const [directive, sentence] of [
      ["worker-src 'self'", '`worker-src` is `\'self\'`'],
      ["'wasm-unsafe-eval'", '`\'wasm-unsafe-eval\'` (only for WebAssembly)'],
    ] as const) {
      expect(generator, directive).toContain(directive);
      expect(doc, directive).toContain(sentence);
    }
    expect(doc).toContain('**`blob:` is not allowed for scripts or workers**');
  });

  it('is linked from both README sections', () => {
    expect(read('README.md').match(/docs\/PWA\.md/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
