import { expect, test, type Page } from '@playwright/test';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { headData, pagePath } from '../../src/seo/page';
import { ZIP_PAGES, type ZipPage } from '../../src/seo/url-model';
import { pages as enPages } from '../../src/i18n/en/pages';
import { pages as jaPages } from '../../src/i18n/ja/pages';
import { ui as enUi } from '../../src/i18n/en/ui';
import { ui as jaUi } from '../../src/i18n/ja/ui';
import { activeRootWorker, visit } from './_covenant-support';
import { drop } from './_helpers';
import { zipHome, zipOp } from './_paths';

const dictionaries = { ja: jaUi, en: enUi };
const contents = { ja: jaPages, en: enPages };

async function check(page: Page, locale: Locale, current: ZipPage) {
  const path = pagePath(locale, current);
  const content = contents[locale][current];
  const head = headData(locale, current, content);
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page).toHaveTitle(head.title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', head.canonical);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', head.description);
  await expect(page.locator('#page-heading')).toHaveCount(1);
  await expect(page.locator('#page-heading')).toHaveText(content.h1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#footer-security')).toHaveAttribute('href', '/SECURITY.md');
  await expect(page.locator('#footer-security')).toHaveText(dictionaries[locale].shared.security);
  await expect(page.locator('[data-chrome-nav]')).toHaveAttribute('aria-label', dictionaries[locale].chrome.navigation);
  await expect(page.locator('[data-chrome-languages]')).toHaveAttribute('aria-label', dictionaries[locale].chrome.languages);
  const home = page.locator('[data-chrome-home]');
  await expect(home).toHaveCount(1);
  await expect(home).toHaveAttribute('href', pagePath(locale, 'hub'));
  await expect(home).toHaveAttribute('aria-label', dictionaries[locale].chrome.home);
  await expect(home).not.toHaveAttribute('aria-current');
  for (const op of AVAILABLE_OPS) {
    const link = page.locator(`[data-chrome-page="${op.id}"]`);
    await expect(link).toHaveAttribute('href', pagePath(locale, op.id));
    await expect(link).toHaveText(dictionaries[locale].workbench[op.i18nKey]);
    if (current === op.id) await expect(link).toHaveAttribute('aria-current', 'page');
    else await expect(link).not.toHaveAttribute('aria-current');
  }
  for (const entry of LOCALES) {
    const link = page.locator(`[data-chrome-locale="${entry.code}"]`);
    await expect(link).toHaveAttribute('href', pagePath(entry.code, current));
    await expect(link).toHaveText(entry.name);
    if (entry.code === locale) await expect(link).toHaveAttribute('aria-current', 'page');
    else await expect(link).not.toHaveAttribute('aria-current');
  }
}

test('all published pages render the same chrome contract', async ({ page, context }) => {
  for (const locale of LOCALES) for (const current of ZIP_PAGES) {
    const response = await context.request.get(pagePath(locale.code, current));
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain(`data-chrome-home href="${pagePath(locale.code, 'hub')}" aria-label="${dictionaries[locale.code].chrome.home}"`);
    for (const op of AVAILABLE_OPS) {
      expect(html).toContain(`data-chrome-page="${op.id}" href="${pagePath(locale.code, op.id)}"`);
    }
    await visit(page, pagePath(locale.code, current));
    await check(page, locale.code, current);
  }
  const favicon = await context.request.get('/icons/favicon.svg');
  expect(favicon.ok()).toBe(true);
  expect(await favicon.text()).toContain('<svg');
  const apple = await context.request.get('/icons/apple-touch-icon.png');
  expect(apple.ok()).toBe(true);
  const bytes = await apple.body();
  expect(bytes.readUInt32BE(16)).toBe(180);
  expect(bytes.readUInt32BE(20)).toBe(180);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/icons/favicon.svg');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
  await activeRootWorker(page);
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('workbox-precache'));
    const paths = (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(key => new URL(key.url).pathname)))).flat();
    return ['/icons/favicon.svg', '/icons/apple-touch-icon.png'].every(path => paths.includes(path));
  });
  expect(cached).toBe(true);
});

test('header, language, select, tabs and history keep the route in sync', async ({ page }) => {
  await visit(page, zipHome('ja'));
  await page.locator('[data-chrome-page="extract"]').click();
  await check(page, 'ja', 'extract');
  await page.locator('[data-chrome-locale="en"]').click();
  await check(page, 'en', 'extract');
  await page.locator('select[aria-label="Language"]').selectOption('ja');
  await check(page, 'ja', 'extract');
  await page.locator('[data-chrome-locale="en"]').click();
  await drop(page, 'zip/sample.zip');
  await page.locator('[data-chrome-locale="ja"]').click();
  await page.locator('[data-op="remove"]').click();
  await check(page, 'ja', 'remove');
  await page.goBack();
  await check(page, 'ja', 'extract');
  await page.goForward();
  await check(page, 'ja', 'remove');
  const length = await page.evaluate(() => history.length);
  await page.locator('[data-chrome-page="remove"]').click();
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.locator('[data-chrome-home]').click();
  await expect(page).toHaveURL(new RegExp(`${pagePath('ja', 'hub').replaceAll('/', '\\/')}$`));
});

test('the chrome is complete in the initial HTML without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', baseURL });
  const page = await context.newPage();
  try {
    for (const locale of LOCALES) for (const current of ZIP_PAGES) {
      await page.goto(pagePath(locale.code, current));
      await check(page, locale.code, current);
    }
  } finally { await context.close(); }
});

test('header navigation retains input and results without requests', async ({ page }) => {
  await visit(page, zipHome('en'));
  await activeRootWorker(page);
  await drop(page, 'zip/sample.zip');
  await page.locator('[data-op="extract"]').click();
  await page.getByRole('button', { name: 'Extract: sample.zip' }).click();
  await expect(page.locator('article.workbench__result')).toHaveCount(1);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const observe = async () => { await page.waitForTimeout(1500); expect(requests).toEqual([]); };
  await page.locator('[data-chrome-page="browse"]').hover();
  await observe();
  await page.locator('[data-chrome-page="browse"]').focus();
  await observe();
  await page.locator('[data-chrome-page="browse"]').click();
  await check(page, 'en', 'browse');
  await observe();
  await expect(page.locator('article.workbench__result')).toHaveCount(1);
  await expect(page.getByText('sample.zip', { exact: true }).first()).toBeVisible();
  expect(requests).toEqual([]);
});

test('archive format corrects unavailable operation and chrome', async ({ page }) => {
  await visit(page, zipOp('en', 'remove'));
  await drop(page, 'archive/sample.7z');
  await check(page, 'en', 'browse');
});
