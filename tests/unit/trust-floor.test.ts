import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { repository } from '../../package.json';
import { allowedUrl } from '../../scripts/check-egress.mjs';
import { hubContent } from '../../src/i18n/hub';
import { imagePageContent } from '../../src/i18n/image-page';
import { LOCALES } from '../../src/i18n/locales';
import { pageContent } from '../../src/i18n/pages';
import { ui } from '../../src/i18n/ui';
import { headData, pagePath, pageUrl, safeJsonLd } from '../../src/seo/page';
import { SITE_PAGES } from '../../src/seo/url-model';

const free = {
  offers: { '@type': 'Offer', price: 0, priceCurrency: 'JPY' },
  applicationCategory: 'UtilitiesApplication', operatingSystem: 'Web browser',
};
// The English colophon is shared by both languages (README contract), outside the language blocks.
const colophon = readFileSync('README.md', 'utf8').match(/^Colophon: (.+)$/m)![1];
const text = {
  ja: ['無料で使えるブラウザアプリです。',
    'コードの一部は AI の支援で書かれています。レビューと判断はすべて運営者が行っています。',
    'ソースコード（GitHub）', '不具合・ご意見（GitHub Issues）',
    '脆弱性の報告は、下のセキュリティ窓口をご利用ください。'],
  en: ['A free app that runs in your browser.',
    'Source code (GitHub)', 'Bugs and feedback (GitHub Issues)',
    'To report a vulnerability, use the Security link below.'],
};

describe('trust floor', () => {
  for (const { code, hreflang } of LOCALES) for (const page of SITE_PAGES) {
    const content = page === 'hub' ? hubContent(code) : page === 'image'
      ? imagePageContent(code) : pageContent(code, page);
    const data = headData(code, page, content);
    it(`${code}/${page} keeps tool attributes separate from the hub`, () => {
      expect(JSON.parse(data.jsonLd)).toEqual(data.application);
      if (page === 'hub') {
        expect(data.application).toEqual({ '@context': 'https://schema.org', '@type': 'WebSite',
          name: 'runlocally', alternateName: content.h1, description: content.description,
          url: pageUrl(code, page), inLanguage: hreflang });
        for (const key of [...Object.keys(free), 'featureList', 'sameAs', 'breadcrumb']) {
          expect(data.application).not.toHaveProperty(key);
        }
      } else {
        expect(data.application).toMatchObject({ '@type': 'SoftwareApplication', ...free });
        expect(data.application.featureList).toEqual(page === 'image' ? ['JPG', 'PNG'] : page === 'top'
          ? [] : pageContent(code, page).steps.map(step => step.heading).filter(Boolean));
      }
      const malicious = headData(code, page, { ...content, description: '</script><>&\u2028\u2029' });
      expect(malicious.jsonLd).not.toMatch(/[<>&\u2028\u2029]/u);
      expect(JSON.parse(malicious.jsonLd)).toEqual(malicious.application);
      expect(safeJsonLd({ value: '</script><>&\u2028\u2029' })).not.toMatch(/[<>&\u2028\u2029]/u);
    });

    it(`${code}/${page} publishes both footer languages and one JSON-LD node`, () => {
      const html = readFileSync(join('dist', pagePath(code, page), 'index.html'), 'utf8');
      const dom = new JSDOM(html);
      try {
        const document = dom.window.document;
        const footer = document.querySelector('.site-footer')!;
        expect(footer).not.toBeNull();
        expect(footer.querySelectorAll('[data-trust-locale]')).toHaveLength(2);
        for (const { code: language } of LOCALES) {
          const block = footer.querySelector(`[data-trust-locale="${language}"]`)!;
          expect(block.getAttribute('lang')).toBe(language);
          for (const value of text[language]) expect(block.textContent).toContain(value);
          expect(block.querySelectorAll('a')).toHaveLength(2);
          for (const [kind, href] of [['source', repository], ['issues', `${repository}/issues`]]) {
            const link = block.querySelector(`[data-trust-link="${kind}"]`)!;
            expect(link.getAttribute('href')).toBe(href);
            expect(allowedUrl(link.getAttribute('href'))).toBeNull();
          }
        }
        expect(footer.querySelectorAll('[ping], [prefetch], [target], [rel~="prefetch"], a[href*="about"]')).toHaveLength(0);
        expect(document.querySelectorAll('#footer-security')).toHaveLength(1);
        const security = footer.querySelector('#footer-security')!;
        expect(security.closest('[data-trust-locale]')).toBeNull();
        expect(security.outerHTML).toBe(`<a id="footer-security" href="/SECURITY.md">${ui[code].shared.security}</a>`);
        expect(html.split(colophon)).toHaveLength(2);
        const shared = footer.querySelector('[data-trust-colophon]')!;
        expect(shared.tagName).toBe('P');
        expect(shared.getAttribute('lang')).toBe('en');
        expect(shared.textContent).toBe(colophon);
        expect(shared.closest('[data-trust-locale]')).toBeNull();
        expect(footer.querySelectorAll('p')).toHaveLength(1);
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        expect(scripts).toHaveLength(1);
        expect(JSON.parse(scripts[0].textContent!)).toEqual(data.application);
      } finally { dom.window.close(); }
    });
  }
});
