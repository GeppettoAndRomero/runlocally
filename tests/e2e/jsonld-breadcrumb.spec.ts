import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { LOCALES } from '../../src/i18n/locales';
import { pagePath, SITE_ORIGIN } from '../../src/seo/page';
import { ready } from './_helpers';
import { SITE_PAGES, ZIP_PAGES } from '../../src/seo/url-model';

const { repository } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const selector = 'script[type="application/ld+json"]';
const read = async (page: Page) => JSON.parse(await page.locator(selector).textContent() ?? 'null');

test('all static pages keep localized hierarchy, sameAs and one safe JSON-LD script', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const { code } of LOCALES) for (const current of SITE_PAGES) {
      await page.goto(pagePath(code, current));
      await expect(page.locator(selector)).toHaveCount(1);
      expect(await page.locator(selector).textContent()).not.toMatch(/[<>&\u2028\u2029]/u);
      const data = await read(page);
      if (current === 'hub') {
        expect(data['@type']).toBe('WebSite');
        expect(data.sameAs).toEqual([repository]);
        expect(data).not.toHaveProperty('@graph');
      } else {
        const [node, breadcrumb] = data['@graph'];
        expect(data['@graph']).toHaveLength(2);
        expect(node['@type']).toBe(current === 'about' ? 'WebPage' : 'SoftwareApplication');
        expect(node.url).toBe(`${SITE_ORIGIN}${pagePath(code, current)}`);
        expect(breadcrumb['@type']).toBe('BreadcrumbList');
        const hierarchy = current === 'top' || current === 'about' || current === 'image'
          ? ['hub', current] as const : ['hub', 'top', current] as const;
        expect(breadcrumb.itemListElement.map((item: { item: string; position: number }) => [item.item, item.position]))
          .toEqual(hierarchy.map((entry, index) => [`${SITE_ORIGIN}${pagePath(code, entry)}`, index + 1]));
        expect(breadcrumb.itemListElement[0].name).toBe(code === 'ja' ? 'ホーム' : 'Home');
        const lastName = await page.locator('#page-heading').textContent();
        expect(breadcrumb.itemListElement.at(-1).name).toBe(lastName);
      }
      expect(JSON.stringify(data)).not.toMatch(/aggregateRating|FAQPage|HowTo/);
    }
  } finally { await context.close(); }
});

test('ZIP operation, language and back/forward changes match static HTML without a reload', async ({ page, request }) => {
  const staticData = new Map<string, unknown>();
  for (const { code } of LOCALES) for (const current of ZIP_PAGES) {
    const path = pagePath(code, current);
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    const raw = html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)?.[1];
    expect(raw).toBeTruthy();
    staticData.set(path, JSON.parse(raw!));
  }
  const match = async (path: string) => {
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect.poll(() => read(page)).toEqual(staticData.get(path));
  };
  await page.goto('/en/zip/');
  await match('/en/zip/');
  await ready(page);
  // A document property survives only same-document SPA transitions.
  await page.evaluate(() => { Object.assign(window, { jsonLdDocument: true }); });
  await page.locator('[data-chrome-locale="ja"]').click();
  await match('/zip/');
  for (const { code } of LOCALES) {
    if (code === 'en') await page.locator('[data-chrome-locale="en"]').click();
    for (const current of ZIP_PAGES.filter(entry => entry !== 'top')) {
      await page.locator(`[data-chrome-page="${current}"]`).click();
      await match(pagePath(code, current));
    }
  }
  await page.goBack(); await match('/en/zip/fix-names/');
  await page.goForward(); await match('/en/zip/create/');
  expect(await page.evaluate(() => Reflect.get(window, 'jsonLdDocument'))).toBe(true);
});
