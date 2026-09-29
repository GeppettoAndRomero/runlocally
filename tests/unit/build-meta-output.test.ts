import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicPagePaths } from '../../scripts/pwa-manifest.mjs';
import { addBuildMetaToOutput, resolveBuildSha } from '../../scripts/build-meta.mjs';

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
  });
}

describe('production HTML output', () => {
  it('covers each public page once with the same SHA and existing head data', () => {
    const root = 'dist';
    const files = htmlFiles(root);
    const expected = publicPagePaths();
    const urls = new Set(files.map(file => {
      const path = relative(root, file).split(sep).join('/');
      return path === 'index.html' ? '/' : `/${path.replace(/index\.html$/, '')}`;
    }));
    expect(urls).toEqual(expected);
    const sha = resolveBuildSha();
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      expect(html.match(/<meta name="build" content="[^"]*">/g)).toEqual([`<meta name="build" content="${sha}">`]);
      expect(html).toMatch(/<link rel="canonical"/);
      expect(html).toMatch(/hreflang="x-default"/);
      expect(html).toMatch(/<link rel="manifest"/);
      expect(html).toMatch(/<script type="application\/ld\+json">/);
    }
  });

  it('uses the supplied output directory and rejects missing or unexpected pages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'build-meta-output-'));
    try {
      const paths = [...publicPagePaths()].map(url => join(root, url.slice(1), 'index.html'));
      for (const file of paths) {
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, '<html><head></head><body></body></html>');
      }
      await addBuildMetaToOutput(pathToFileURL(root), 'dev');
      for (const file of paths) expect(readFileSync(file, 'utf8')).toContain('<meta name="build" content="dev">');
      rmSync(paths[0]);
      await expect(addBuildMetaToOutput(pathToFileURL(root), 'dev')).rejects.toThrow('Missing public HTML');
      writeFileSync(paths[0], '<html><head></head></html>');
      writeFileSync(join(root, 'extra.html'), '<html><head></head></html>');
      await expect(addBuildMetaToOutput(pathToFileURL(root), 'dev')).rejects.toThrow('Unexpected or duplicate HTML');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
