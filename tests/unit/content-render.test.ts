import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { pageContent } from '../../src/i18n/pages';
import { chromeUi, ui } from '../../src/i18n/ui';
import { pagePath, type PublicPage } from '../../src/seo/page';

const output = join(process.cwd(), 'dist');

for (const { code } of LOCALES) for (const current of ['top', ...AVAILABLE_OPS.map(op => op.id)] as PublicPage[]) {
  test(`${code}/${current} preserves the initial content and operation links`, () => {
    const html = readFileSync(join(output, pagePath(code, current).slice(1), 'index.html'), 'utf8');
    const document: Document = new JSDOM(html).window.document;
    const content = pageContent(code, current);
    expect(document.documentElement.lang).toBe(code);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelectorAll('#page-heading')).toHaveLength(1);
    expect(document.querySelector('#page-heading')?.textContent).toBe(content.h1);
    const region = document.querySelector('section#page-content.page-content');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')).toBe(content.h1);
    expect(region?.querySelector(':scope > p.page-lead')?.textContent).toBe(content.lead);
    expect([...region!.querySelectorAll(':scope > ol > li')].map(li => [
      li.querySelector(':scope > h2')?.textContent, li.querySelector(':scope > h2 + p')?.textContent,
    ])).toEqual(content.steps.map(step => [step.heading, step.body]));
    expect([...region!.querySelectorAll(':scope > dl > dt')].map(node => node.textContent)).toEqual(content.faq.map(item => item.question));
    expect([...region!.querySelectorAll(':scope > dl > dd')].map(node => node.textContent)).toEqual(content.faq.map(item => item.answer));
    expect([...region!.querySelectorAll(':scope > ul > li')].map(node => node.textContent)).toEqual(content.limits);
    expect(document.querySelectorAll('[data-operation-cards]')).toHaveLength(LOCALES.length);
    for (const locale of LOCALES) {
      const cards = document.querySelector(`[data-operation-cards][data-lang="${locale.code}"]`);
      expect(cards?.classList.contains('page-content')).toBe(true);
      expect(cards?.parentElement).toBe(region?.parentElement);
      expect(cards?.getAttribute('aria-label')).toBe(chromeUi[locale.code].navigation);
      const articles = [...cards!.querySelectorAll('article.operation-cards__card')];
      expect(articles).toHaveLength(AVAILABLE_OPS.length);
      for (const [index, op] of AVAILABLE_OPS.entries()) {
        const link = articles[index].querySelector('h2 > a');
        expect(link?.textContent).toBe(ui[locale.code].workbench[op.i18nKey]);
        expect(link?.getAttribute('href')).toBe(pagePath(locale.code, op.id));
        expect(articles[index].querySelector('p')?.textContent).toBe(pageContent(locale.code, op.id).description);
        expect(link?.hasAttribute('data-chrome-page')).toBe(false);
      }
    }
  });
}
