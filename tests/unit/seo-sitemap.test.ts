import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, ENGLISH_LOCALE } from '../../src/i18n/locales';
import { OPS } from '../../src/i18n/ops';
import { pageUrl, SITE_ORIGIN } from '../../src/seo/page';

function htmlPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlPaths(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

function locations(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].replaceAll('&amp;', '&'));
}

describe('built sitemap', () => {
  it('lists exactly the HTML pages built by the product Astro config', () => {
    const output = mkdtempSync(join(tmpdir(), 'seo-sitemap-'));
    try {
      execFileSync(process.execPath, ['node_modules/astro/astro.js', 'build', '--outDir', output], {
        cwd: process.cwd(), stdio: 'pipe', timeout: 120_000,
      });

      const generatedPages = htmlPaths(output).map(path => {
        const route = relative(output, path).replace(/(^|\/)index\.html$/, '$1');
        return new URL(`/${route}`, SITE_ORIGIN).href;
      });
      expect(generatedPages.sort()).toEqual([pageUrl(DEFAULT_LOCALE, 'top'), pageUrl(ENGLISH_LOCALE, 'top')].sort());
      expect(readFileSync(join(output, 'index.html'), 'utf8')).toContain('property="og:locale" content="ja_JP"');
      expect(readFileSync(join(output, 'index.html'), 'utf8')).toContain('property="og:locale:alternate" content="en_US"');
      expect(readFileSync(join(output, 'en/index.html'), 'utf8')).toContain('property="og:locale" content="en_US"');
      expect(readFileSync(join(output, 'en/index.html'), 'utf8')).toContain('property="og:locale:alternate" content="ja_JP"');

      const index = readFileSync(join(output, 'sitemap-index.xml'), 'utf8');
      const childNames = readdirSync(output).filter(name => /^sitemap-\d+\.xml$/.test(name));
      expect(childNames.length).toBeGreaterThan(0);
      expect(locations(index).sort()).toEqual(childNames.map(name => `${SITE_ORIGIN}/${name}`).sort());

      const listedPages = childNames.flatMap(name => locations(readFileSync(join(output, name), 'utf8')));
      expect(listedPages.sort()).toEqual(generatedPages.sort());
      for (const op of OPS.filter(entry => !entry.available)) {
        expect(listedPages).not.toContain(`${SITE_ORIGIN}/${op.slug}/`);
        expect(listedPages).not.toContain(`${SITE_ORIGIN}/en/${op.slug}/`);
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  }, 125_000);
});
