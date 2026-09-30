import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { expect } from 'vitest';
import { hubContent } from '../../src/i18n/hub';
import { SITE_ORIGIN } from '../../src/seo/page';

const pairs = [
  ['/', '/en/'],
  ['/zip/', '/en/zip/'],
  ['/zip/view/', '/en/zip/view/'],
  ['/zip/extract/', '/en/zip/extract/'],
  ['/zip/remove/', '/en/zip/remove/'],
  ['/zip/fix-names/', '/en/zip/fix-names/'],
] as const;
const url = (path: string) => `${SITE_ORIGIN}${path}`;
const expected = pairs.flatMap(([ja, en]) => [url(ja), url(en)]).sort();
const xml = (source: string): Document => new JSDOM(source, { contentType: 'application/xml' }).window.document;
const locations = (document: Document) => [...document.getElementsByTagName('loc')].map(node => node.textContent);
const alternate = (elements: Element[], language: string, target: string) => {
  expect(elements.filter(element => element.getAttribute('hreflang') === language)
    .map(element => element.getAttribute('href'))).toEqual([target]);
};

function htmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

/** Checks a finished product build: twelve routes in the sitemap, matching HTML and alternates. */
export function checkBuiltSitemap(output: string): void {
  const childNames = readdirSync(output).filter(name => /^sitemap-\d+\.xml$/.test(name));
  expect(childNames.length).toBeGreaterThan(0);
  const index = xml(readFileSync(join(output, 'sitemap-index.xml'), 'utf8'));
  expect(locations(index).sort()).toEqual(childNames.map(name => url(`/${name}`)).sort());

  const entries = childNames.flatMap(name => {
    const document = xml(readFileSync(join(output, name), 'utf8'));
    return [...document.getElementsByTagName('url')].map(element => ({
      loc: element.getElementsByTagName('loc')[0]?.textContent,
      links: [...element.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'link')],
    }));
  });
  expect(entries).toHaveLength(12);
  expect(entries.map(entry => entry.loc).sort()).toEqual(expected);
  expect(new Set(entries.map(entry => entry.loc)).size).toBe(12);

  const files = htmlFiles(output);
  expect(files).toHaveLength(12);
  expect(files.map(file => url(`/${relative(output, file).replace(/(^|\/)index\.html$/, '$1')}`)).sort()).toEqual(expected);

  for (const [ja, en] of pairs) for (const path of [ja, en]) {
    const pageUrl = url(path);
    const entry = entries.find(item => item.loc === pageUrl);
    expect(entry).toBeDefined();
    const links = entry!.links;
    expect(links).toHaveLength(3);
    expect(links.every(link => link.getAttribute('rel') === 'alternate')).toBe(true);
    expect(links.map(link => link.getAttribute('hreflang')).sort()).toEqual(['en', 'ja', 'x-default']);
    alternate(links, 'ja', url(ja));
    alternate(links, 'en', url(en));
    alternate(links, 'x-default', url(en));

    const html: Document = new JSDOM(readFileSync(join(output, path.slice(1), 'index.html'), 'utf8')).window.document;
    expect(html.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(pageUrl);
    const htmlLinks = [...html.head.querySelectorAll('link[rel="alternate"]')];
    expect(htmlLinks).toHaveLength(3);
    expect(htmlLinks.map(link => [link.getAttribute('hreflang'), link.getAttribute('href')]).sort())
      .toEqual(links.map(link => [link.getAttribute('hreflang'), link.getAttribute('href')]).sort());
    if (path === '/' || path === '/en/') {
      const content = hubContent(path === '/' ? 'ja' : 'en');
      const heading = html.querySelector('#page-heading');
      expect(heading?.textContent).toBe(content.h1);
      expect(html.querySelector('#page-content .page-lead')?.textContent).toBe(content.lead);
      const card = html.querySelector('.hub-card');
      expect(card?.querySelector('a')?.textContent).toBe(content.zipCardTitle);
      expect(card?.querySelector('a')?.getAttribute('href')).toBe(path === '/' ? '/zip/' : '/en/zip/');
      expect(card?.textContent).toContain(content.zipCardDescription);
    }
  }
}
