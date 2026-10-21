import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { addBuildMetaToOutput } from '../../scripts/build-meta.mjs';
import { transformPrecache } from '../../scripts/pwa-manifest.mjs';
import { LOCALES, DEFAULT_LOCALE } from '../../src/i18n/locales';
import { notFound, notFoundContent, validateNotFound } from '../../src/i18n/not-found';
import { pagePath } from '../../src/seo/page';
import { NOT_FOUND_FILE, SITE_PAGES } from '../../src/seo/url-model';

const sitePaths = LOCALES.flatMap(({ code }) => SITE_PAGES.map(page => pagePath(code, page)));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'not-found-page-'));
  for (const path of sitePaths) {
    const file = join(root, `${path.slice(1)}index.html`);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '<html><head></head><body></body></html>');
  }
  writeFileSync(join(root, NOT_FOUND_FILE), '<html><head></head><body></body></html>');
  return root;
}

describe('not-found dictionary', () => {
  it('covers every locale with nonblank strings and rejects gaps', () => {
    for (const { code } of LOCALES) {
      const content = notFoundContent(code);
      expect(Object.keys(content).sort()).toEqual(['body', 'heading', 'hubLink', 'title', 'zipLink']);
      expect(content.title).toContain('runlocally');
    }
    expect(() => validateNotFound({ ...notFound, en: { ...notFound.en, body: ' ' } })).toThrow('Missing not-found content: en');
    expect(() => validateNotFound({ ja: notFound.ja } as typeof notFound)).toThrow('Unexpected not-found locale');
    expect(() => notFoundContent('xx' as never)).toThrow('Missing not-found content: xx');
  });
});

describe('built not-found document', () => {
  const html = readFileSync(join('dist', NOT_FOUND_FILE), 'utf8');
  const document: Document = new JSDOM(html).window.document;

  it('is noindex, has no canonical or alternates, and lists every locale with hub and ZIP links', () => {
    expect(document.documentElement.getAttribute('lang')).toBe(DEFAULT_LOCALE);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelectorAll('link[rel="alternate"]')).toHaveLength(0);
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(document.title).toBe(notFoundContent(DEFAULT_LOCALE).title);
    expect(document.querySelector('[data-chrome-home]')?.getAttribute('href')).toBe(pagePath(DEFAULT_LOCALE, 'hub'));
    for (const { code } of LOCALES) {
      const content = notFoundContent(code);
      const section = document.querySelector(`[data-not-found-locale="${code}"]`);
      expect(section?.getAttribute('lang')).toBe(code);
      expect(section?.querySelector('h1')?.textContent).toBe(content.heading);
      expect(section?.textContent).toContain(content.body);
      const links = [...section!.querySelectorAll('a')].map(link => [link.getAttribute('href'), link.textContent]);
      expect(links).toEqual([[pagePath(code, 'hub'), content.hubLink], [pagePath(code, 'top'), content.zipLink]]);
    }
    expect(html).not.toContain('component-export=');
  });

  it('carries the build stamp without entering the service worker precache', async () => {
    expect(html.match(/<meta name="build" content="[^"]*">/g)).toHaveLength(1);
    const sw = readFileSync(join('dist', 'sw.js'), 'utf8');
    expect(sw).not.toContain(NOT_FOUND_FILE);
    expect(sw).not.toContain('"/404');
  });

  it('is stamped by the build step but rejected by the precache transform', async () => {
    const root = fixture();
    try {
      await addBuildMetaToOutput(pathToFileURL(`${root}/`), 'dev');
      expect(readFileSync(join(root, NOT_FOUND_FILE), 'utf8')).toContain('<meta name="build" content="dev">');
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('<meta name="build" content="dev">');
      const entries = [
        ...sitePaths.map(path => ({ url: `${path.slice(1)}index.html`, revision: path })),
        { url: NOT_FOUND_FILE, revision: 'nf' },
      ];
      await expect(transformPrecache(entries, root)).rejects.toThrow(`Unexpected or duplicate HTML: ${NOT_FOUND_FILE}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
