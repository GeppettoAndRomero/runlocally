import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'vite';

const root = process.cwd();
const temporary: string[] = [];
const pair = ['worker-bundle.js', 'libarchive.wasm'];
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const file = join(dir, item.name);
    return item.isDirectory() ? walk(file) : [file];
  });
}

function inspectOutput(out: string): void {
  const files = walk(out);
  const canonical = pair.map((name) => join(out, 'vendor/libarchive', name));
  for (let index = 0; index < pair.length; index += 1) {
    const expected = readFileSync(join(root, 'vendor/libarchive-lean', pair[index]));
    expect(readFileSync(canonical[index])).toEqual(expected);
    const hash = digest(expected);
    expect(files.filter((file) => digest(readFileSync(file)) === hash)).toEqual([canonical[index]]);
  }
  const browserChunks = files.filter((file) => file.endsWith('.js') && relative(out, file).startsWith('_astro/'));
  expect(browserChunks.some((file) => readFileSync(file, 'utf8').includes('/vendor/libarchive/worker-bundle.js'))).toBe(true);
  expect(files.filter((file) => /worker-bundle|libarchive\.wasm/.test(relative(out, file))).sort()).toEqual(canonical.sort());
  for (const file of browserChunks) {
    const code = readFileSync(file, 'utf8');
    expect(code).not.toMatch(/\/_astro\/worker-bundle-[\w-]+\.js/);
    expect(code).not.toContain('./worker-bundle.js');
  }
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('libarchive browser build', () => {
  it.each([false, true])('uses the vendor pair with NOTICE analysis = %s', async (notice) => {
    const dir = mkdtempSync(join(tmpdir(), 'libarchive-build-'));
    temporary.push(dir);
    const entry = join(dir, 'entry.js');
    const out = join(dir, 'dist');
    const publicDir = join(dir, 'public');
    mkdirSync(join(publicDir, 'vendor/libarchive'), { recursive: true });
    for (const name of pair) {
      copyFileSync(join(root, 'vendor/libarchive-lean', name), join(publicDir, 'vendor/libarchive', name));
    }
    writeFileSync(entry, `import { openArchive } from ${JSON.stringify(resolve(root, 'src/app/engine.ts'))}; globalThis.archiveEntry = openArchive;`);
    const previous = process.env.NOTICE_ANALYZE;
    if (notice) process.env.NOTICE_ANALYZE = '1';
    else delete process.env.NOTICE_ANALYZE;
    let config;
    try {
      config = (await import(/* @vite-ignore */ `${pathToFileURL(resolve(root, 'astro.config.mjs')).href}?notice=${notice}`)).default;
    } finally {
      if (previous === undefined) delete process.env.NOTICE_ANALYZE;
      else process.env.NOTICE_ANALYZE = previous;
    }
    await build({
      root,
      publicDir,
      configFile: false,
      ...config.vite,
      build: {
        ...config.vite.build,
        assetsDir: config.build.assets,
        outDir: out,
        emptyOutDir: true,
        rollupOptions: { input: entry },
      },
      logLevel: 'error',
    });
    inspectOutput(out);
    if (notice) {
      const maps = walk(out).filter((file) => file.endsWith('.map'));
      expect(maps.length).toBeGreaterThan(0);
      expect(maps.some((file) => readFileSync(file, 'utf8').includes('libarchive.js/dist/libarchive.js'))).toBe(true);
    }
  }, 60_000);

  it('rejects a renamed copy of the vendor worker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'libarchive-duplicate-'));
    temporary.push(dir);
    mkdirSync(join(dir, 'vendor/libarchive'), { recursive: true });
    mkdirSync(join(dir, '_astro'), { recursive: true });
    for (const name of pair) copyFileSync(join(root, 'vendor/libarchive-lean', name), join(dir, 'vendor/libarchive', name));
    writeFileSync(join(dir, '_astro/entry.js'), 'globalThis.archiveWorker = "/vendor/libarchive/worker-bundle.js";');
    inspectOutput(dir);
    copyFileSync(join(dir, 'vendor/libarchive/worker-bundle.js'), join(dir, 'copy.js'));
    expect(() => inspectOutput(dir)).toThrow();
  });
});
