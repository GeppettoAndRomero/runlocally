import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { type Locale } from '../../src/i18n/locales';
import { activeRootWorker, origin, url, visit } from './_covenant-support';

const { repository } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const paths = { ja: '/about/', en: '/en/about/' } as const;
const labels = { ja: 'このサイトについて', en: 'About this site' };
const headings = { ja: 'runlocally について', en: 'About runlocally' };
function observeExternal(context: BrowserContext) {
  const requests: string[] = [];
  context.on('request', request => {
    if (new URL(request.url()).origin !== origin) requests.push(request.url());
  });
  return requests;
}
async function footer(page: Page, locale: Locale) {
  const visible = page.locator(`.site-footer [data-trust-locale="${locale}"]`);
  const hidden = page.locator(`.site-footer [data-trust-locale="${locale === 'ja' ? 'en' : 'ja'}"]`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(visible).toBeVisible();
  await expect(hidden).toBeHidden();
  const link = visible.getByRole('link', { name: labels[locale], exact: true });
  await expect(link).toHaveAttribute('href', paths[locale]);
  await expect(page.locator('.site-footer').getByRole('link', { name: labels[locale === 'ja' ? 'en' : 'ja'], exact: true })).toHaveCount(0);
  return link;
}
async function about(page: Page, locale: Locale) {
  await expect(page.locator('#page-heading')).toHaveText(headings[locale]);
  await expect(page.locator('#page-content.page-content .page-lead')).toBeVisible();
  await expect(page.locator('#page-content ol > li')).toHaveCount(4);
  await expect(page.locator('#page-content ul a')).toHaveCount(3);
  for (const [index, href] of [repository, `${repository}/issues`, '/SECURITY.md'].entries()) {
    await expect(page.locator('#page-content ul a').nth(index)).toHaveAttribute('href', href);
  }
  await expect(page.locator('[data-chrome-nav], .workbench, [component-export="ImageConverter"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://runlocally.app${paths[locale]}`);
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(3);
  for (const [language, path] of [['ja', paths.ja], ['en', paths.en], ['x-default', paths.en]]) {
    await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute('href', `https://runlocally.app${path}`);
  }
  await footer(page, locale);
}

test('c370-about Functions serves about GET and HEAD while preserving redirects, gone and missing responses', async ({ request }) => {
  for (const path of Object.values(paths)) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request.fetch(url(path), { method, maxRedirects: 0 });
      expect(response.status(), `${method} ${path}`).toBe(200);
      expect(response.headers()['content-security-policy']).toMatch(/(?:^|;\s*)connect-src 'self'(?:;|$)/);
      expect(response.headers().location).toBeUndefined();
      if (method === 'GET') expect(await response.text()).toContain('id="page-content"');
    }
  }
  for (const [from, to] of [['/zip-viewer/ja/?from=old', '/zip/view/'], ['/zip-viewer/?from=old', '/en/zip/view/']]) {
    const response = await request.get(url(from), { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(new URL(response.headers().location, origin).href).toBe(url(to));
  }
  for (const path of ['/zip-viewer/sw.js', '/en/zip-viewer/', '/recover-zip/']) {
    const response = await request.get(url(path), { maxRedirects: 0 });
    expect(response.status()).toBe(410);
    expect(response.headers().location).toBeUndefined();
  }
  expect((await request.get(url('/undefined-c370-about/'), { maxRedirects: 0 })).status()).toBe(404);
});

test('c370-about direct visits, language and history use ordinary documents with accessible footer links at 360px', async ({ page, context, browserName }) => {
  test.info().annotations.push({ type: 'capability', description: browserName === 'chromium'
    ? 'Context request monitoring includes service-worker requests through initial precache.'
    : 'Only observable context requests are covered; complete service-worker traffic is not exposed.' });
  const external = observeExternal(context);
  await page.setViewportSize({ width: 360, height: 800 });
  const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (const locale of ['ja', 'en'] as const) {
    await visit(page, paths[locale]);
    if (browserName === 'chromium') await activeRootWorker(page);
    await about(page, locale);
    const visible = page.locator(`.site-footer [data-trust-locale="${locale}"]`);
    const other = locale === 'ja' ? 'en' : 'ja';
    const hidden = page.locator(`.site-footer [data-trust-locale="${other}"]`);
    const tree = await page.locator('.site-footer').ariaSnapshot();
    expect(tree).toContain(labels[locale]);
    expect(tree).not.toContain(labels[other]);
    const links = visible.getByRole('link');
    await expect(links).toHaveCount(3);
    await links.nth(0).focus();
    await expect(links.nth(0)).toBeFocused();
    for (const next of [links.nth(1), links.nth(2), page.locator('#footer-security')]) {
      await page.keyboard.press(tabKey);
      await expect(next).toBeFocused();
    }
    for (const link of await hidden.locator('a').all()) {
      await link.evaluate(element => (element as HTMLElement).focus());
      await expect(link).not.toBeFocused();
    }
    await links.nth(0).hover(); await links.nth(1).hover(); await links.nth(2).focus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const link of await page.locator('#page-content ul a').all()) { await link.hover(); await link.focus(); }
  }
  await visit(page, paths.ja);
  await page.locator('[data-chrome-locale="en"]').click(); await about(page, 'en');
  await page.goBack(); await about(page, 'ja');
  await page.goForward(); await about(page, 'en');
  // Full document transitions must remain observable even when a service worker supplies them.
  for (const locale of ['ja', 'en'] as const) for (const entry of ['', 'zip/', 'image/']) {
    const prefix = locale === 'ja' ? '/' : '/en/';
    await page.goto(url(`${prefix}${entry}`));
    const link = await footer(page, locale);
    const navigation = page.waitForEvent('response', response => response.request().isNavigationRequest() && new URL(response.url()).pathname === paths[locale]);
    await link.click(); await navigation;
    await about(page, locale);
  }
  await visit(page, '/zip/');
  await page.locator('[data-chrome-locale="en"]').click(); await footer(page, 'en');
  await page.goBack(); await footer(page, 'ja');
  await page.goForward(); await footer(page, 'en');
  await page.locator('select[aria-label="Language"]').selectOption('ja');
  const link = await footer(page, 'ja');
  await link.click(); await about(page, 'ja');
  await page.waitForTimeout(1500);
  expect(external, 'including failed external attempts').toEqual([]);
});

test('c370-about static body and ordinary links work without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, serviceWorkers: 'block', viewport: { width: 360, height: 800 } });
  const external = observeExternal(context);
  try {
    const page = await context.newPage();
    for (const locale of ['ja', 'en'] as const) {
      const response = await page.goto(url(paths[locale]));
      // The second locale was already opened by the first iteration's language switch, so the
      // browser may revalidate it (304, no body). Check the rendered document instead of the body.
      expect([200, 304]).toContain(response?.status());
      expect(await page.content()).toMatch(/connect-src (?:'|&#39;|&#x27;)self/);
      await about(page, locale);
      await expect(page.locator('#page-content ul a').nth(0)).toHaveAttribute('href', repository);
      // No evaluate calls in a JavaScript-disabled context: use layout boxes and locator assertions.
      for (const element of [page.locator('#page-content'), page.locator('.site-footer')]) {
        const box = await element.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(360);
      }
      await page.locator(`[data-chrome-locale="${locale === 'ja' ? 'en' : 'ja'}"]`).click();
      await about(page, locale === 'ja' ? 'en' : 'ja');
    }
    await page.waitForTimeout(1500);
    expect(external).toEqual([]);
  } finally { await context.close(); }
});
