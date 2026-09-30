import { expect, test, type Page } from '@playwright/test';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { hubContent } from '../../src/i18n/hub';
import { ui as enUi } from '../../src/i18n/en/ui';
import { ui as jaUi } from '../../src/i18n/ja/ui';
import { pagePath } from '../../src/seo/page';
import { ready } from './_helpers';
import { zipHome, zipOp } from './_paths';

const dictionaries = { ja: jaUi, en: enUi } as const;

async function checkHub(page: Page, locale: Locale) {
  const content = hubContent(locale);
  await expect(page).toHaveURL(new RegExp(`${pagePath(locale, 'hub').replaceAll('/', '\\/')}$`));
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#page-heading')).toHaveText(content.h1);
  const brand = page.locator('[data-chrome-home]');
  await expect(brand).toHaveCount(1);
  await expect(brand).toHaveAttribute('href', pagePath(locale, 'hub'));
  await expect(brand).toHaveAttribute('aria-label', dictionaries[locale].chrome.home);
  await expect(brand).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-chrome-nav], [data-chrome-page]')).toHaveCount(0);
  const card = page.locator('.hub-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('h2 a')).toHaveText(content.zipCardTitle);
  await expect(card.locator('h2 a')).toHaveAttribute('href', zipHome(locale));
  await expect(card.locator('p')).toHaveText(content.zipCardDescription);
  await expect(page.locator('[data-chrome-languages]')).toHaveAttribute('aria-label', dictionaries[locale].chrome.languages);
  for (const entry of LOCALES) {
    const link = page.locator(`[data-chrome-locale="${entry.code}"]`);
    await expect(link).toHaveAttribute('href', pagePath(entry.code, 'hub'));
    await expect(link).toHaveText(entry.name);
    if (entry.code === locale) await expect(link).toHaveAttribute('aria-current', 'page');
    else await expect(link).not.toHaveAttribute('aria-current');
  }
  await expect(page.locator('footer p')).toHaveCount(1);
  await expect(page.locator('footer p')).toContainText("all review and decisions are the maintainer's.");
  await expect(page.getByText("all review and decisions are the maintainer's.")).toHaveCount(1);
  await expect(page.locator('#footer-security')).toHaveCount(1);
  await expect(page.locator('#footer-security')).toHaveAttribute('href', '/SECURITY.md');
  await expect(page.locator('#footer-security')).toHaveText(dictionaries[locale].shared.security);
}

for (const { code } of LOCALES) {
  test(`${code} hub, language links, and ZIP card`, async ({ page }) => {
    await page.goto(pagePath(code, 'hub'));
    await checkHub(page, code);
    const other = code === 'ja' ? 'en' : 'ja';
    await page.locator(`[data-chrome-locale="${other}"]`).click();
    await checkHub(page, other);
    await page.locator(`[data-chrome-locale="${code}"]`).click();
    await checkHub(page, code);
    await page.locator('.hub-card h2 a').click();
    await expect(page).toHaveURL(new RegExp(`${zipHome(code).replaceAll('/', '\\/')}$`));
    await ready(page);
    await expect(page.locator('[data-chrome-home]')).not.toHaveAttribute('aria-current');
  });
}

test('both hubs render without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', baseURL });
  const page = await context.newPage();
  try {
    for (const { code } of LOCALES) {
      await page.goto(pagePath(code, 'hub'));
      await checkHub(page, code);
      const other = code === 'ja' ? 'en' : 'ja';
      await page.locator(`[data-chrome-locale="${other}"]`).click();
      await checkHub(page, other);
      await page.locator('.hub-card h2 a').click();
      await expect(page).toHaveURL(new RegExp(`${zipHome(other).replaceAll('/', '\\/')}$`));
    }
  } finally { await context.close(); }
});

async function brandLeavesDocument(page: Page, locale: Locale) {
  await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });
  const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await page.locator('[data-chrome-home]').click();
  await navigation;
  await page.waitForLoadState('domcontentloaded');
  await checkHub(page, locale);
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBeUndefined();
}

test('brand opens a new document from ZIP top and dynamic operation routes', async ({ page }) => {
  await page.goto(zipHome('ja'));
  await ready(page);
  await brandLeavesDocument(page, 'ja');
  await page.goto(zipOp('ja', 'extract'));
  await ready(page);
  await page.locator('[data-chrome-locale="en"]').click();
  await expect(page).toHaveURL(new RegExp(`${zipOp('en', 'extract').replaceAll('/', '\\/')}$`));
  await expect(page.locator('[data-chrome-home]')).toHaveAttribute('href', pagePath('en', 'hub'));
  await expect(page.locator('[data-chrome-home]')).not.toHaveAttribute('aria-current');
  await page.locator('[data-chrome-page="remove"]').click();
  await expect(page).toHaveURL(new RegExp(`${zipOp('en', 'remove').replaceAll('/', '\\/')}$`));
  await brandLeavesDocument(page, 'en');
});

test('hub does not request the Workbench component or engine assets', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const zipResponse = await context.request.get(zipHome('en'));
    expect(zipResponse.ok()).toBe(true);
    const zipHtml = await zipResponse.text();
    const island = zipHtml.match(/<astro-island\b(?=[^>]*component-export="Workbench")[^>]*>/)?.[0];
    expect(island).toBeDefined();
    const componentUrl = island?.match(/component-url="([^"]+)"/)?.[1];
    expect(componentUrl).toBeTruthy();
    const componentPath = new URL(componentUrl!, baseURL).pathname;
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(pagePath('en', 'hub'));
    await checkHub(page, 'en');
    await expect(page.locator('astro-island[component-export="PwaStartup"]')).toHaveCount(1);
    await expect(page.locator('astro-island[component-export="PwaStartup"]')).not.toHaveAttribute('ssr');
    expect(requests).not.toContain(componentPath);
    expect(requests.filter(path => /libarchive.*(?:worker|\.wasm)/i.test(path))).toEqual([]);
    await expect(page.locator('astro-island[component-export="Workbench"], input[type="file"], [data-op]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__toolReady)).toBeUndefined();
    await page.locator('.hub-card h2 a').click();
    await expect(page).toHaveURL(new RegExp(`${zipHome('en').replaceAll('/', '\\/')}$`));
    await ready(page);
    expect(requests).toContain(componentPath);
  } finally { await context.close(); }
});
