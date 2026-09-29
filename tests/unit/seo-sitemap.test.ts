import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS, OPS } from '../../src/i18n/ops';
import { pageContent } from '../../src/i18n/pages';
import { ui } from '../../src/i18n/ui';
import type { PublicPage } from '../../src/seo/page';
import { ogLocale, pageUrl, SITE_ORIGIN } from '../../src/seo/page';

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
      const expected = LOCALES.flatMap(({ code }) => (['top', ...AVAILABLE_OPS.map(op => op.id)] as PublicPage[]).map(page => pageUrl(code, page)));
      expect(expected).toHaveLength(LOCALES.length * (AVAILABLE_OPS.length + 1));
      expect(generatedPages.sort()).toEqual(expected.sort());
      for (const { code } of LOCALES) for (const page of ['top', ...AVAILABLE_OPS.map(op => op.id)] as PublicPage[]) {
        const html = readFileSync(join(output, new URL(pageUrl(code, page)).pathname.slice(1), 'index.html'), 'utf8');
        const content = pageContent(code, page);
        for (const value of [content.h1, content.lead, ...content.steps.flatMap(step => [step.heading, step.body]), ...content.faq.flatMap(item => [item.question, item.answer]), ...content.limits]) {
          expect(html).toContain(value.replaceAll('&', '&amp;'));
        }
        expect(html).toContain(`content="${ogLocale(code)}"`);
        expect(html).toContain(`id="footer-security" href="/SECURITY.md">${ui[code].shared.security}</a>`);
        expect(html).toContain(pageUrl(code, page));
      }

      const index = readFileSync(join(output, 'sitemap-index.xml'), 'utf8');
      const childNames = readdirSync(output).filter(name => /^sitemap-\d+\.xml$/.test(name));
      expect(childNames.length).toBeGreaterThan(0);
      expect(locations(index).sort()).toEqual(childNames.map(name => `${SITE_ORIGIN}/${name}`).sort());

      const listedPages = childNames.flatMap(name => locations(readFileSync(join(output, name), 'utf8')));
      expect(listedPages.sort()).toEqual(generatedPages.sort());
      for (const { code } of LOCALES) for (const op of OPS.filter(entry => !entry.available)) {
        expect(listedPages).not.toContain(`${pageUrl(code, 'top')}${op.slug}/`);
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  }, 125_000);
});
