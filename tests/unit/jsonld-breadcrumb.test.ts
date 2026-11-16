import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { repository } from '../../package.json';
import { aboutContent } from '../../src/i18n/about';
import { hubContent } from '../../src/i18n/hub';
import { imagePageContent } from '../../src/i18n/image-page';
import { LOCALES } from '../../src/i18n/locales';
import { pageContent } from '../../src/i18n/pages';
import { chromeUi } from '../../src/i18n/ui';
import { headData, pagePath, pageUrl } from '../../src/seo/page';
import { SITE_PAGES } from '../../src/seo/url-model';

describe('JSON-LD roles and localized breadcrumbs', () => {
  for (const { code } of LOCALES) for (const page of SITE_PAGES) {
    const content = page === 'hub' ? hubContent(code) : page === 'about' ? aboutContent(code)
      : page === 'image' ? imagePageContent(code) : pageContent(code, page);
    it(`${code}/${page} has exactly the required entities and real ancestors in built HTML`, () => {
      const data = headData(code, page, content);
      const expected = page === 'hub' ? {
        '@context': 'https://schema.org', '@type': 'WebSite', name: 'runlocally',
        alternateName: content.h1, sameAs: [repository], description: content.description,
        url: pageUrl(code, page), inLanguage: code,
      } : {
        '@context': 'https://schema.org', '@graph': [
          { ...Object.fromEntries(Object.entries(data.application).filter(([key]) => key !== '@context')) },
          { '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: chromeUi[code].home, item: pageUrl(code, 'hub') },
            ...(page === 'top' || page === 'about' || page === 'image' ? [] : [
              { '@type': 'ListItem', position: 2, name: pageContent(code, 'top').h1, item: pageUrl(code, 'top') },
            ]),
            { '@type': 'ListItem', position: page === 'top' || page === 'about' || page === 'image' ? 2 : 3,
              name: content.h1, item: pageUrl(code, page) },
          ] },
        ],
      };
      expect(JSON.parse(data.jsonLd)).toEqual(expected);
      expect(data.jsonLd).not.toMatch(/aggregateRating|FAQPage|HowTo/);
      const dom = new JSDOM(readFileSync(join('dist', pagePath(code, page), 'index.html'), 'utf8'));
      try {
        const scripts = dom.window.document.querySelectorAll('script[type="application/ld+json"]');
        expect(scripts).toHaveLength(1);
        expect(JSON.parse(scripts[0].textContent!)).toEqual(expected);
        if (page !== 'hub') {
          const graph = JSON.parse(data.jsonLd)['@graph'];
          expect(graph.map((node: { '@type': string }) => node['@type'])).toEqual([
            page === 'about' ? 'WebPage' : 'SoftwareApplication', 'BreadcrumbList',
          ]);
          expect(graph[0]).not.toHaveProperty('sameAs');
          expect(graph[1]).not.toHaveProperty('offers');
        }
      } finally { dom.window.close(); }
    });
    it(`${code}/${page} escapes script delimiters in page and breadcrumb names`, () => {
      const marker = '</script><script>&\u2028\u2029';
      const data = headData(code, page, { ...content, h1: marker, description: marker });
      expect(data.jsonLd).not.toMatch(/[<>&\u2028\u2029]/u);
      const dom = new JSDOM(`<script type="application/ld+json">${data.jsonLd}</script>`);
      try {
        expect(dom.window.document.querySelectorAll('script')).toHaveLength(1);
        const parsed = JSON.parse(dom.window.document.querySelector('script')!.textContent!);
        const node = page === 'hub' ? parsed : parsed['@graph'][0];
        expect(node.description).toBe(marker);
        expect(node[page === 'hub' ? 'alternateName' : 'name']).toBe(marker);
        if (page !== 'hub') {
          expect(parsed['@graph'][1].itemListElement.at(-1).name).toBe(marker);
        }
      } finally { dom.window.close(); }
    });
  }
});

describe('source repository constant', () => {
  it('equals package.json repository', async () => {
    const { SOURCE_REPOSITORY } = await import('../../src/seo/page');
    const { repository } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(SOURCE_REPOSITORY).toBe(repository);
  });
});
