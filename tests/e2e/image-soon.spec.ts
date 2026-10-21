import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { imagePageContent } from '../../src/i18n/image-page';
import { SITE_PAGES, PUBLIC_PAGES, pagePath } from '../../src/seo/url-model';
import { origin } from './_covenant-support';

const sitePaths = LOCALES.flatMap(({ code }) => SITE_PAGES.map(page => pagePath(code, page)));

async function imageReady(page: Page, locale: Locale) {
  const content = imagePageContent(locale);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#page-heading')).toHaveText(content.h1);
  await expect(page.locator('#page-content')).toContainText(content.lead);
  await expect(page.locator('#page-content')).toContainText(content.body);
  await expect(page.locator('#page-content a')).toHaveCount(2);
  await expect(page.getByRole('link', { name: content.hubLink, exact: true })).toHaveAttribute('href', pagePath(locale, 'hub'));
  await expect(page.getByRole('link', { name: content.zipLink, exact: true })).toHaveAttribute('href', pagePath(locale, 'top'));
  await expect(page.locator('[data-chrome-nav], .workbench, .operation-cards')).toHaveCount(0);
  await expect(page.locator('astro-island[component-export="Workbench"]')).toHaveCount(0);
  await expect(page.locator('astro-island[component-export="PwaStartup"]')).toHaveCount(0);
  await expect(page.locator('astro-island[component-export="ImageConverter"]')).toHaveCount(1);
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://runlocally.app${pagePath(locale, 'image')}`);
  for (const { code } of LOCALES) {
    await expect(page.locator(`link[hreflang="${code}"]`)).toHaveAttribute('href', `https://runlocally.app${pagePath(code, 'image')}`);
    await expect(page.locator(`[data-chrome-locale="${code}"]`)).toHaveAttribute('href', pagePath(code, 'image'));
  }
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute('href', 'https://runlocally.app/en/image/');
}

for (const { code } of LOCALES) {
  test(`${code} image document, hub entry and language navigation`, async ({ page }) => {
    expect([200, 304]).toContain((await page.goto(pagePath(code, 'image')))?.status());
    await imageReady(page, code);
    const other = code === 'ja' ? 'en' : 'ja';
    await page.locator(`[data-chrome-locale="${other}"]`).click();
    await imageReady(page, other);
    await page.getByRole('link', { name: imagePageContent(other).hubLink, exact: true }).click();
    await page.locator(`.hub-card a[href="${pagePath(other, 'image')}"]`).click();
    await imageReady(page, other);
    await page.getByRole('link', { name: imagePageContent(other).zipLink, exact: true }).click();
    await expect(page).toHaveURL(new URL(pagePath(other, 'top'), origin).href);
  });

  test(`${code} image body and links without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      expect([200, 304]).toContain((await page.goto(new URL(pagePath(code, 'image'), origin).href))?.status());
      await imageReady(page, code);
      await page.getByRole('link', { name: imagePageContent(code).hubLink, exact: true }).click();
      await page.locator(`.hub-card a[href="${pagePath(code, 'image')}"]`).click();
      await imageReady(page, code);
    } finally { await context.close(); }
  });

  test(`chromium: ${code} image startup, communication and offline documents`, async ({ browser, browserName, request }) => {
    test.skip(browserName !== 'chromium');
    test.info().annotations.push({ type: 'capability', description: 'SW communication and offline checks cover Chromium; other browsers and actual installation require device verification.' });
    const sw = await readFile('dist/sw.js', 'utf8');
    const revisions = new Map([...sw.matchAll(/(?:url:|"url":)"([^"]+)"[^}]*?(?:revision:|"revision":)"([^"]+)"/g)]
      .map(match => [new URL(match[1], origin).pathname, match[2]]));
    const zip = await (await request.get(new URL('/zip/', origin).href)).text();
    const island = [...zip.matchAll(/<astro-island\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes('component-export="Workbench"'));
    const entry = island?.match(/component-url="([^"]+)"/)?.[1];
    expect(entry).toBeTruthy();
    const vendor = ['/vendor/libarchive/libarchive.wasm', '/vendor/libarchive/worker-bundle.js', '/vendor/libheif/libheif.wasm'];
    const forbidden = [new URL(entry!, origin).pathname, ...vendor.filter(path => !path.includes('libheif'))];
    const violations: string[] = [];
    const workerRequests: string[] = [];
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    context.on('request', request => {
      const url = new URL(request.url());
      const worker = Boolean(request.serviceWorker());
      if (worker) workerRequests.push(url.pathname);
      const knownPath = sitePaths.includes(url.pathname) || ['/sw.js', '/manifest.webmanifest', '/SECURITY.md'].includes(url.pathname) ||
        ['/_astro/', '/vendor/', '/icons/'].some(prefix => url.pathname.startsWith(prefix));
      const knownQuery = !url.search || (url.searchParams.size === 1 && url.searchParams.has('__WB_REVISION__') &&
        revisions.get(url.pathname) === url.searchParams.get('__WB_REVISION__'));
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()) || request.postData() !== null || url.hash || !knownPath || !knownQuery ||
        (!worker && forbidden.includes(url.pathname))) violations.push(`${request.method()} ${url.origin}${url.pathname}`);
    });
    context.on('page', page => page.on('websocket', socket => violations.push(`WebSocket: ${socket.url()}`)));
    try {
      const page = await context.newPage();
      await page.goto(new URL(pagePath(code, 'image'), origin).href);
      await imageReady(page, code);
      await page.waitForFunction(async paths => {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active?.state !== 'activated' || registration.scope !== new URL('/', location.href).href) return false;
        const saved: string[] = [];
        for (const name of (await caches.keys()).filter(name => name.startsWith('workbox-precache'))) {
          for (const key of await (await caches.open(name)).keys()) saved.push(new URL(key.url).pathname);
        }
        return paths.every(path => saved.includes(path));
      }, [...sitePaths, ...vendor], { timeout: 60_000 });
      if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
        await page.reload();
        await imageReady(page, code);
      }
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      for (const path of vendor) expect(workerRequests).toContain(path);
      expect(violations).toEqual([]);
      await context.setOffline(true);
      for (const { code: locale } of LOCALES) {
        const response = await page.goto(new URL(pagePath(locale, 'image'), origin).href);
        expect(response?.ok()).toBe(true);
        expect(response?.fromServiceWorker()).toBe(true);
        await imageReady(page, locale);
        const reload = await page.reload();
        expect(reload?.ok()).toBe(true);
        expect(reload?.fromServiceWorker()).toBe(true);
        await imageReady(page, locale);
      }
      expect(violations).toEqual([]);
    } finally { await context.setOffline(false); await context.close(); }
  });
}

test('image is absent from sitemap and public pages have no robots meta', async ({ request, page }) => {
  const index = await request.get(new URL('/sitemap-index.xml', origin).href);
  expect(index.ok()).toBe(true);
  const locations = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)];
  expect(locations.length).toBeGreaterThan(0);
  const listed: string[] = [];
  for (const [, location] of locations) {
    const response = await request.get(new URL(new URL(location).pathname, origin).href);
    expect(response.ok()).toBe(true);
    listed.push(...[...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname));
  }
  const publicPaths = LOCALES.flatMap(({ code }) => PUBLIC_PAGES.map(page => pagePath(code, page)));
  expect(listed.sort()).toEqual([...publicPaths].sort());
  expect(listed).toHaveLength(14);
  for (const path of publicPaths) {
    // A revalidated cache entry answers 304; both mean the page exists and was served.
    expect([200, 304]).toContain((await page.goto(path))?.status());
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  }
});
