import { test, expect, type Page } from '@playwright/test';
import { LOCALES } from '../../src/i18n/locales';
import { pagePath } from '../../src/seo/page';
import { activeRootWorker, origin, publicPaths, visit } from './_covenant-support';
import { publicReady } from './_helpers';

const expectedPages = [
  '/', '/en/',
  '/zip/', '/en/zip/',
  '/zip/view/', '/en/zip/view/',
  '/zip/extract/', '/en/zip/extract/',
  '/zip/remove/', '/en/zip/remove/',
  '/zip/fix-names/', '/en/zip/fix-names/',
];
const vendor = ['/vendor/libarchive/libarchive.wasm', '/vendor/libarchive/worker-bundle.js'];

test('public pages are the twelve distinct routes', () => {
  expect(publicPaths).toHaveLength(12);
  expect(new Set(publicPaths).size).toBe(12);
  expect([...publicPaths].sort()).toEqual([...expectedPages].sort());
});

async function cachePaths(page: Page) {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of (await caches.keys()).filter(name => name.startsWith('workbox-precache'))) {
      for (const key of await (await caches.open(name)).keys()) paths.push(new URL(key.url).pathname);
    }
    return paths;
  });
}

async function offlineDocument(page: Page, path: string, reload = false) {
  const response = reload ? await page.reload() : await page.goto(new URL(path, origin).href);
  await publicReady(page);
  expect(new URL(page.url()).pathname).toBe(path);
  await expect(page.locator('#page-heading')).toBeVisible();
  await expect(page.locator('#page-content')).toBeVisible();
  expect(response?.ok(), `offline document ${path}`).toBe(true);
  expect(response?.fromServiceWorker(), `service worker document ${path}`).toBe(true);
}

for (const locale of LOCALES) {
  test(`chromium: hub starts PWA and serves every page offline from ${locale.code}`, async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium');
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    try {
      const page = await context.newPage();
      const hub = pagePath(locale.code, 'hub');
      await visit(page, hub);
      expect(new URL(page.url()).pathname).toBe(hub);
      await expect(page.locator('.workbench')).toHaveCount(0);
      expect(await page.evaluate(() => window.__toolReady === true)).toBe(false);
      await activeRootWorker(page);
      const paths = await cachePaths(page);
      const savedPages = paths.filter(path => path.endsWith('/'));
      expect(savedPages).toHaveLength(12);
      expect([...savedPages].sort()).toEqual([...expectedPages].sort());
      for (const path of vendor) expect(paths).toContain(path);

      await context.setOffline(true);
      await offlineDocument(page, hub, true);
      for (const path of expectedPages) {
        await offlineDocument(page, path);
        await offlineDocument(page, path, true);
      }
    } finally {
      await context.setOffline(false);
      await context.close();
    }
  });
}

test('chromium: hub does not fetch ZIP engine or Workbench entry', async ({ browser, browserName, request }) => {
  test.skip(browserName !== 'chromium');
  const zipResponse = await request.get(new URL('/zip/', origin).href);
  expect(zipResponse.ok()).toBe(true);
  const html = await zipResponse.text();
  const island = [...html.matchAll(/<astro-island\b[^>]*>/g)]
    .map(match => match[0]).find(tag => /component-export="Workbench"/.test(tag));
  expect(island, 'ZIP HTML must declare a Workbench island').toBeDefined();
  const entry = island?.match(/component-url="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  expect(entry, 'Workbench island must identify its entry asset').toBeTruthy();
  const forbidden = new Set([new URL(entry!, origin).pathname, ...vendor]);
  expect(forbidden.size).toBeGreaterThan(0);

  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const events: { path: string; owner: string }[] = [];
  context.on('request', request => {
    let owner = 'page-or-worker';
    if (request.serviceWorker()) owner = 'service-worker';
    else {
      try { owner = request.frame().url() || 'page-or-worker'; } catch { /* dedicated worker */ }
    }
    events.push({ path: new URL(request.url()).pathname, owner });
  });
  try {
    const page = await context.newPage();
    await visit(page, '/');
    await activeRootWorker(page);
    const paths = await cachePaths(page);
    for (const path of vendor) expect(paths).toContain(path);
    expect(events.some(event => event.owner === 'service-worker' && vendor.includes(event.path))).toBe(true);
    expect(events.filter(event => forbidden.has(event.path) && event.owner !== 'service-worker')).toEqual([]);
  } finally {
    await context.close();
  }
});
