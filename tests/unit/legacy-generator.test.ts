import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts/gen-legacy.mjs');
const temps: string[] = [];

function run(scriptPath: string, check = false) {
  return spawnSync(process.execPath, check ? [scriptPath, '--check'] : [scriptPath], { encoding: 'utf8' });
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'legacy-generator-'));
  temps.push(dir);
  for (const folder of ['scripts', 'functions', 'legacy', 'src/i18n']) await mkdir(join(dir, folder), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(dir, 'scripts/gen-legacy.mjs'), await readFile(script));
  await writeFile(join(dir, 'functions/_middleware.js'), await readFile(join(root, 'functions/_middleware.js')));
  await writeFile(join(dir, 'legacy/slugs.json'), '["first-tool","second-tool"]\n');
  await writeFile(join(dir, 'src/i18n/ops.ts'), "export const OPS = [{ slug: 'first-tool', available: true }, { slug: 'second-tool', available: false }];\n");
  return { dir, scriptPath: join(dir, 'scripts/gen-legacy.mjs'), middleware: join(dir, 'functions/_middleware.js') };
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('legacy generator', () => {
  it('checks the real generated tables without writing', async () => {
    const before = await readFile(join(root, 'functions/_middleware.js'));
    expect(run(script, true).status).toBe(0);
    expect(await readFile(join(root, 'functions/_middleware.js'))).toEqual(before);
  });

  it('is deterministic and detects a stale or missing table without writing', async () => {
    const { scriptPath, middleware } = await fixture();
    expect(run(scriptPath, true).status).not.toBe(0);
    const initial = await readFile(middleware);
    expect(run(scriptPath).status).toBe(0);
    const generated = await readFile(middleware);
    expect(generated).not.toEqual(initial);
    expect(run(scriptPath).status).toBe(0);
    expect(await readFile(middleware)).toEqual(generated);
    expect(run(scriptPath, true).status).toBe(0);
    await writeFile(middleware, generated.toString().replace('first-tool', 'wrong-tool'));
    const stale = await readFile(middleware);
    expect(run(scriptPath, true).status).not.toBe(0);
    expect(await readFile(middleware)).toEqual(stale);
  });

  it('changes the table when an operation becomes available', async () => {
    const { dir, scriptPath, middleware } = await fixture();
    expect(run(scriptPath).status).toBe(0);
    const before = await readFile(middleware, 'utf8');
    expect(before).toContain('const OLD_JA_REDIRECT_PATHS = [\n  "/first-tool/ja/"\n]');
    expect(before).toContain('const NEW_SITE_SLUGS = [\n  "first-tool"\n]');
    await writeFile(join(dir, 'src/i18n/ops.ts'), "export const OPS = [{ slug: 'first-tool', available: true }, { slug: 'second-tool', available: true }];\n");
    expect(run(scriptPath, true).status).not.toBe(0);
    expect(await readFile(middleware, 'utf8')).toBe(before);
    expect(run(scriptPath).status).toBe(0);
    const after = await readFile(middleware, 'utf8');
    expect(after).toContain('"/second-tool/ja/"');
    expect(after).toContain('const NEW_SITE_SLUGS = [\n  "first-tool",\n  "second-tool"\n]');
    expect(run(scriptPath, true).status).toBe(0);
  });

  it.each([
    '["first-tool","first-tool"]',
    '["first-tool","Bad_Slug"]',
    '["first-tool"]',
    '{}',
  ])('rejects invalid legacy input %s', async input => {
    const { dir, scriptPath, middleware } = await fixture();
    await writeFile(join(dir, 'legacy/slugs.json'), input);
    const before = await readFile(middleware);
    expect(run(scriptPath).status).not.toBe(0);
    expect(run(scriptPath, true).status).not.toBe(0);
    expect(await readFile(middleware)).toEqual(before);
  });

  it.each([
    "export const OPS = [{ slug: 'missing-tool', available: true }];\n",
    "export const OPS = [{ slug: 'first-tool', available: true }, { slug: 'first-tool', available: false }];\n",
    "export const OPS = [{ slug: 'first-tool', available: 'yes' }];\n",
  ])('rejects invalid operation entries', async source => {
    const { dir, scriptPath, middleware } = await fixture();
    await writeFile(join(dir, 'src/i18n/ops.ts'), source);
    const before = await readFile(middleware);
    expect(run(scriptPath).status).not.toBe(0);
    expect(await readFile(middleware)).toEqual(before);
  });
});
