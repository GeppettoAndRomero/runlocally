import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { operationLabel, AVAILABLE_OPS } from '../../src/i18n/ops';
import { pageContent } from '../../src/i18n/pages';
import { chromeUi, menuUi, ui } from '../../src/i18n/ui';
import { pagePath } from '../../src/seo/page';
import { ZIP_PAGES } from '../../src/seo/url-model';

const output = join(process.cwd(), 'dist');

for (const { code } of LOCALES) for (const current of ZIP_PAGES) {
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
    // One operation navigation, in the page's own language; a language change rebuilds it in src/app/page-display.ts.
    expect(document.querySelectorAll('[data-operation-cards]')).toHaveLength(1);
    const cards = document.querySelector(`[data-operation-cards][data-lang="${code}"]`);
    expect(cards?.classList.contains('page-content')).toBe(true);
    expect(cards?.parentElement).toBe(region?.parentElement);
    expect(cards?.getAttribute('aria-label')).toBe(chromeUi[code].navigation);
    const articles = [...cards!.querySelectorAll('article.operation-cards__card')];
    expect(articles).toHaveLength(AVAILABLE_OPS.length);
    for (const [index, op] of AVAILABLE_OPS.entries()) {
      const link = articles[index].querySelector('h2 > a');
      expect(link?.textContent).toBe(operationLabel(op, ui[code].workbench, menuUi[code]));
      expect(link?.getAttribute('href')).toBe(pagePath(code, op.id));
      expect(articles[index].querySelector('p')?.textContent).toBe(pageContent(code, op.id).description);
      expect(link?.hasAttribute('data-chrome-page')).toBe(false);
    }
  });
}
