import { expect, test, type Page } from '@playwright/test';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { pages as enPages } from '../../src/i18n/en/pages';
import { pages as jaPages } from '../../src/i18n/ja/pages';
import { ui as enUi } from '../../src/i18n/en/ui';
import { ui as jaUi } from '../../src/i18n/ja/ui';
import { pagePath } from '../../src/seo/page';
import { ZIP_PAGES, type ZipPage } from '../../src/seo/url-model';
import { ready } from './_helpers';
import { hubContent } from '../../src/i18n/hub';
import { zipHome } from './_paths';

const paths = ZIP_PAGES;
const contents = { ja: jaPages, en: enPages };
const dictionaries = { ja: jaUi, en: enUi };
const visibleCards = (page: Page) => page.locator('[data-operation-cards]:visible');

async function assertContent(page: Page, locale: Locale, current: ZipPage) {
  const content = contents[locale][current];
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#page-heading')).toHaveText(content.h1);
  const region = page.locator('section#page-content.page-content');
  await expect(region).toHaveCount(1);
  await expect(region).toHaveAttribute('aria-label', content.h1);
  await expect(region.locator(':scope > p.page-lead')).toHaveText(content.lead);
  await expect(region.locator(':scope > ol > li')).toHaveCount(content.steps.length);
  for (const [index, step] of content.steps.entries()) {
    await expect(region.locator(':scope > ol > li').nth(index).locator('h2')).toHaveText(step.heading);
    await expect(region.locator(':scope > ol > li').nth(index).locator('p')).toHaveText(step.body);
  }
  await expect(region.locator(':scope > dl > dt')).toHaveText(content.faq.map(item => item.question));
  await expect(region.locator(':scope > dl > dd')).toHaveText(content.faq.map(item => item.answer));
  await expect(region.locator(':scope > ul > li')).toHaveText(content.limits);
}

async function assertCards(page: Page, locale: Locale, current: ZipPage, session = false) {
  const cards = visibleCards(page);
  if (current !== 'top' || session) {
    await expect(cards).toHaveCount(0);
    for (const item of await page.locator('[data-operation-cards] a').all()) {
      await expect(item).toBeHidden();
    }
    return;
  }
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('data-lang', locale);
  const links = cards.locator('article h2 > a');
  await expect(links).toHaveCount(AVAILABLE_OPS.length);
  for (const [index, op] of AVAILABLE_OPS.entries()) {
    await expect(links.nth(index)).toHaveText(dictionaries[locale].workbench[op.i18nKey]);
    await expect(links.nth(index)).toHaveAttribute('href', pagePath(locale, op.id));
    await expect(cards.locator('article p').nth(index)).toHaveText(contents[locale][op.id].description);
  }
  await expect(links.first()).toHaveCSS('text-decoration-line', 'underline');
  await links.first().focus();
  await expect(links.first()).toBeFocused();
}

test('initial pages and links work without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', baseURL });
  const page = await context.newPage();
  try {
    for (const { code } of LOCALES) for (const current of paths) {
      await page.goto(pagePath(code, current));
      await assertContent(page, code, current);
      await assertCards(page, code, current);
    }
    for (const { code } of LOCALES) for (const op of AVAILABLE_OPS) {
      await page.goto(pagePath(code, 'top'));
      await visibleCards(page).getByRole('link', { name: dictionaries[code].workbench[op.i18nKey] }).click();
      await expect(page).toHaveURL(new RegExp(`${pagePath(code, op.id).replaceAll('/', '\\/')}$`));
      await assertContent(page, code, op.id);
    }
  } finally { await context.close(); }
});

test('hydration, route changes, input, and reset update content and cards', async ({ page }) => {
  await page.goto(zipHome('ja'));
  await ready(page);
  await assertContent(page, 'ja', 'top');
  await assertCards(page, 'ja', 'top');
  await page.locator('[data-chrome-page="extract"]').click();
  await assertContent(page, 'ja', 'extract');
  await assertCards(page, 'ja', 'extract');
  await page.locator('[data-chrome-locale="en"]').click();
  await assertContent(page, 'en', 'extract');
  await page.locator('select[aria-label="Language"]').selectOption('ja');
  await assertContent(page, 'ja', 'extract');
  await page.goBack();
  await assertContent(page, 'en', 'extract');
  await page.goForward();
  await assertContent(page, 'ja', 'extract');
  await page.locator('[data-chrome-home]').click();
  await expect(page).toHaveURL(new RegExp(`${pagePath('ja', 'hub').replaceAll('/', '\\/')}$`));
  await expect(page.locator('#page-heading')).toHaveText(hubContent('ja').h1);
  await page.locator('.hub-card h2 a').click();
  await ready(page);
  await assertContent(page, 'ja', 'top');
  await assertCards(page, 'ja', 'top');
  await page.locator('input[type="file"]').setInputFiles('tests/fixtures/zip/sample.zip');
  await expect(page.locator('html')).toHaveAttribute('data-session', 'open');
  await expect(page.locator('#page-content')).toBeHidden();
  await assertCards(page, 'ja', 'top', true);
  await page.locator('[data-chrome-page="extract"]').click();
  await assertContent(page, 'ja', 'extract');
  await expect(page.locator('#page-content')).toBeHidden();
  await assertCards(page, 'ja', 'extract', true);
  await page.goBack();
  await assertContent(page, 'ja', 'top');
  await expect(page.locator('#page-content')).toBeHidden();
  await assertCards(page, 'ja', 'top', true);
  await page.getByRole('button', { name: /^リセット/ }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-session', 'open');
  await assertContent(page, 'ja', 'top');
  await assertCards(page, 'ja', 'top');
});

test('card links navigate to a document and theme follows the system setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(zipHome('en'));
  await ready(page);
  const light = await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor);
  expect(dark).not.toBe(light);
  // A marker on the current document proves the click loaded a new document instead of using the History API.
  await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });
  const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await visibleCards(page).locator('article h2 > a').first().click();
  await navigation;
  await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBeUndefined();
  await expect(page).toHaveURL(new RegExp(`${pagePath('en', AVAILABLE_OPS[0].id).replaceAll('/', '\\/')}$`));
  await assertContent(page, 'en', AVAILABLE_OPS[0].id);
});

for (const scheme of ['light', 'dark'] as const) for (const width of [360, 768, 1280]) {
  test(`${scheme} at ${width}px keeps content and cards within the viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    let overall = 0;
    for (const { code } of LOCALES) for (const current of paths) {
      await page.goto(pagePath(code, current));
      await ready(page);
      await assertContent(page, code, current);
      await assertCards(page, code, current);
      const metrics = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('#page-content, [data-operation-cards]')]
          .filter(node => getComputedStyle(node).display !== 'none');
        return {
          sectionOverflow: nodes.map(node => Math.max(0, node.scrollWidth - node.clientWidth)),
          outside: nodes.flatMap(node => [node, ...node.querySelectorAll('*')]).reduce((max, node) => {
            const bounds = node.getBoundingClientRect();
            return Math.max(max, Math.max(0, -bounds.left), Math.max(0, bounds.right - innerWidth));
          }, 0),
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          background: getComputedStyle(document.body).backgroundColor,
          token: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
        };
      });
      expect(metrics.sectionOverflow).toEqual(current === 'top' ? [0, 0] : [0]);
      expect(metrics.outside).toBeLessThanOrEqual(0.5);
      expect(metrics.token).toMatch(/^#[0-9a-f]{6}$/i);
      expect(metrics.background).toBe(`rgb(${[1, 3, 5].map(index => parseInt(metrics.token.slice(index, index + 2), 16)).join(', ')})`);
      overall = Math.max(overall, metrics.pageOverflow);
    }
    console.log(`${test.info().project.name} ${scheme} ${width}px page overflow max: ${overall}px`);
  });
}
