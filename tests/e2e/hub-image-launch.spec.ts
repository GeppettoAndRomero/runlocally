import { expect, test, type Page } from '@playwright/test';
import { hubContent } from '../../src/i18n/hub';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { pagePath } from '../../src/seo/page';
import { activeRootWorker, origin, visit } from './_covenant-support';

async function imageEntry(page: Page, locale: Locale) {
  const content = hubContent(locale);
  const cards = page.locator('.hub-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('h2 a')).toHaveText(content.zipCardTitle);
  await expect(cards.nth(0).locator('h2 a')).toHaveAttribute('href', pagePath(locale, 'top'));
  await expect(cards.nth(0).locator('p')).toHaveText(content.zipCardDescription);
  await expect(cards.nth(1).locator('h2 a')).toHaveText(content.imageCardTitle);
  await expect(cards.nth(1).locator('p')).toHaveText(content.imageCardDescription);
  await expect(cards.nth(1).locator('h2 a')).toHaveAttribute('href', pagePath(locale, 'image'));
  const response = page.waitForResponse(response => response.request().isNavigationRequest() &&
    new URL(response.url()).pathname === pagePath(locale, 'image'));
  await cards.nth(1).locator('h2 a').click();
  await expect(page).toHaveURL(new URL(pagePath(locale, 'image'), origin).href);
  await expect(page.locator('input[type="file"][accept="image/*,.heic,.heif,.avif"]')).toBeEnabled();
  await expect(page.locator('input[name="image-output-format"]')).toHaveCount(2);
  return response;
}

for (const { code } of LOCALES) {
  test(`${code} hub image card opens converter input`, async ({ page }) => {
    await visit(page, pagePath(code, 'hub'));
    await imageEntry(page, code);
  });
}

test('manifest launch contract and Chromium offline hub image entry', async ({ browser, browserName, request }) => {
  const manifestResponse = await request.get(new URL('/manifest.webmanifest', origin).href);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', name: 'runlocally', short_name: 'runlocally',
    description: 'ファイルを送信せず、ブラウザ内でファイルを扱うツールサイトです。' });
  if (browserName !== 'chromium') return;
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const initial = await context.newPage();
    await visit(initial, '/');
    await activeRootWorker(initial);
    expect(await initial.evaluate(async () => {
      for (const name of (await caches.keys()).filter(name => name.startsWith('workbox-precache'))) {
        if ((await (await caches.open(name)).keys()).some(key => new URL(key.url).pathname === '/')) return true;
      }
      return false;
    })).toBe(true);
    await context.setOffline(true);
    const launch = await context.newPage();
    const response = await launch.goto(new URL(manifest.start_url, origin).href);
    expect(response?.ok()).toBe(true);
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(launch.locator('#page-heading')).toHaveText(hubContent('ja').h1);
    const reload = await launch.reload();
    expect(reload?.ok()).toBe(true);
    expect(reload?.fromServiceWorker()).toBe(true);
    await expect(launch.locator('#page-heading')).toHaveText(hubContent('ja').h1);
    expect((await imageEntry(launch, 'ja')).fromServiceWorker()).toBe(true);
  } finally {
    await context.setOffline(false);
    await context.close();
  }
});
