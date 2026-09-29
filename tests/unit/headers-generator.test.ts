import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateHeaders, hashesFromHtml } from '../../scripts/gen-headers.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const hash = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
async function fixture(html = '<script>hello</script>') {
  const root = await mkdtemp(join(tmpdir(), 'headers-'));
  roots.push(root);
  await Promise.all(['dist/en', 'docker', 'public'].map((dir) => mkdir(join(root, dir), { recursive: true })));
  await writeFile(join(root, 'dist/index.html'), html);
  return root;
}

describe('built HTML hashing', () => {
  it('hashes exact script text including whitespace and non-ASCII characters', () => {
    const text = '\n  日本語();  \n';
    expect(hashesFromHtml(`<script>${text}</script>`)).toEqual([hash(text)]);
    expect(hashesFromHtml('<script>hello</script>')).toEqual([hash('hello')]);
  });

  it('ignores external scripts, JSON-LD and non-script changes', () => {
    const html = '<script src="/a.js">ignored</script><script type="application/ld+json">{"a":1}</script><script type="module">ok()</script>';
    expect(hashesFromHtml(html)).toEqual([hash('ok()')]);
    expect(hashesFromHtml(html.replace('{"a":1}', '{"a":2}') + '<p>changed</p>')).toEqual([hash('ok()')]);
  });

  it('collects distinct scripts across pages and regenerates after HTML changes', async () => {
    const root = await fixture('<script>same()</script>');
    await writeFile(join(root, 'dist/en/index.html'), '<script type="module" data-x="1">same()</script><script data-x="1" type="module">other()</script>');
    await generateHeaders(root);
    const first = await readFile(join(root, 'dist/_headers'), 'utf8');
    expect(first.match(/'sha256-/g)).toHaveLength(2);
    expect(first).toContain(hash('same()'));
    expect(first).toContain(hash('other()'));
    await generateHeaders(root, true);
    await generateHeaders(root);
    expect(await readFile(join(root, 'dist/_headers'), 'utf8')).toBe(first);
    await writeFile(join(root, 'dist/en/index.html'), '<script>new()</script>');
    await expect(generateHeaders(root, true)).rejects.toThrow('out of date');
    expect(await readFile(join(root, 'dist/_headers'), 'utf8')).toBe(first);
    await generateHeaders(root);
    expect(await readFile(join(root, 'dist/_headers'), 'utf8')).toContain(hash('new()'));
  });
});

describe('generation checks', () => {
  it('succeeds without a service worker and keeps its cache rule', async () => {
    const root = await fixture();
    await generateHeaders(root);
    await generateHeaders(root, true);
    expect(await readFile(join(root, 'dist/_headers'), 'utf8')).toContain('/sw.js\n  Cache-Control: no-cache');
    expect(await readFile(join(root, 'docker/headers.caddy'), 'utf8')).toContain('header /sw.js {');
  });

  it('rejects handwritten headers, missing HTML, and stale outputs', async () => {
    const root = await fixture();
    await generateHeaders(root);
    const caddy = join(root, 'docker/headers.caddy');
    await writeFile(caddy, 'changed');
    await expect(generateHeaders(root, true)).rejects.toThrow('out of date');
    expect(await readFile(caddy, 'utf8')).toBe('changed');
    await writeFile(join(root, 'public/_headers'), '');
    await expect(generateHeaders(root)).rejects.toThrow('must not exist');
    await rm(join(root, 'public/_headers'));
    await symlink('missing', join(root, 'public/_headers'));
    await expect(generateHeaders(root, true)).rejects.toThrow('must not exist');
    await rm(join(root, 'public/_headers'));
    await rm(join(root, 'dist/index.html'));
    await expect(generateHeaders(root)).rejects.toThrow('No built HTML');
  });
});
