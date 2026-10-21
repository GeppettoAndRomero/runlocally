import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { glob } from 'tinyglobby';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('package.json', 'utf8'))['size-limit'];
const sw = readFileSync('dist/sw.js', 'utf8');
const precached = new Set([...sw.matchAll(/url:"([^"]+)"/g)].map(match => `dist/${match[1]}`));

// Follow static/dynamic imports and emitted worker URLs in the generated JS.
function closure(entries: string[], all: string[]): Set<string> {
  const found = new Set<string>();
  function visit(path: string) {
    if (found.has(path)) return;
    found.add(path);
    for (const [, value] of readFileSync(path, 'utf8').matchAll(/["'`]([^"'`]+\.js)["'`]/g)) {
      const target = value.startsWith('/') ? `dist${value}` : posix.join(posix.dirname(path), value);
      if (all.includes(target)) visit(target);
    }
  }
  entries.forEach(visit);
  return found;
}

describe('image page build', () => {
  it('partitions every JS/CSS/HTML asset without overlap and keeps image conversion in the main budget', async () => {
    const all = await glob('dist/**/*.{js,css,html}');
    const main = await glob(config.find((item: { name: string }) => item.name === 'precache').path);
    const glue = await glob(config.find((item: { name: string }) => item.name === 'heic-glue').path);
    expect(main.length).toBeGreaterThan(0);
    expect(glue.length).toBeGreaterThan(0);
    expect(main.filter(path => glue.includes(path))).toEqual([]);
    expect([...main, ...glue].sort()).toEqual(all.sort());
    const image = all.filter(path => /\/image-worker-[^/]+\.js$/.test(path));
    const heic = all.filter(path => /\/heic-worker-[^/]+\.js$/.test(path));
    expect(image).toHaveLength(1);
    expect(heic).toHaveLength(1);
    const heicOnly = closure(heic, all);
    expect(glue.sort()).toEqual([...heicOnly].sort());
    for (const path of closure(image, all)) {
      if (!heicOnly.has(path)) expect(main).toContain(path);
    }
    for (const pattern of [/\/ImageConverter\./, /\/client\./, /\/comlink\./, /\/PwaStartup\./, /\/sw\.js$/]) {
      const matching = all.filter(path => pattern.test(path));
      expect(matching.length).toBeGreaterThan(0);
      for (const path of matching) expect(main).toContain(path);
    }
    expect(config.find((item: { name: string }) => item.name === 'precache').limit).toBe('210 KB');
    expect(config.find((item: { name: string }) => item.name === 'wasm')).toMatchObject({ limit: '5 MB', gzip: false, brotli: false });
  });

  it('precaches both real workers, their dependencies and WASM, with glue recorded by analysis sourcemaps', async () => {
    const all = await glob('dist/**/*.js');
    for (const name of ['image-worker', 'heic-worker']) {
      const entries = all.filter(path => path.includes(`/${name}-`));
      expect(entries).toHaveLength(1);
      for (const path of closure(entries, all)) expect(precached).toContain(path);
    }
    expect(precached).toContain('dist/vendor/libheif/libheif.wasm');
    const maps = await glob('.notice-build/_astro/heic-worker-*.js.map');
    expect(maps).toHaveLength(1);
    expect(JSON.parse(readFileSync(maps[0], 'utf8')).sources.some((path: string) => path.endsWith('libheif-js/libheif-wasm/libheif.js'))).toBe(true);
    for (const path of ['image', 'en/image']) {
      const html = readFileSync(`dist/${path}/index.html`, 'utf8');
      expect(html.match(/component-export="ImageConverter"/g)).toHaveLength(1);
      expect(html).not.toContain('component-export="PwaStartup"');
      expect(html).not.toContain('data-chrome-nav');
    }
  });
});
