import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { LEGACY_SW_SCOPES } from '../fixtures/sw/legacy';
import { activeRootWorker, url, visit } from './_covenant-support';
import { observePwaStartup, publicReady } from './_helpers';

// Artificial old registrations and caches; these are not captures from an installed device.
async function stageOldState(context: BrowserContext): Promise<Page> {
  const preparation = '/__migration_setup__/';
  await context.route(`**${preparation}`, route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>Migration preparation</title>',
  }));
  const page = await context.newPage();
  await page.goto(url(preparation));
  const initial = await page.evaluate(async scopes => {
    for (const scope of scopes) {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Registration did not activate: ${scope}`)), 30_000);
        const wait = () => {
          if (registration.active?.state === 'activated') { clearTimeout(timeout); resolve(); }
          else setTimeout(wait, 100);
        };
        wait();
      });
    }
    for (const name of ['old-tool-cache-v1', 'other-old-cache', 'workbox-sentinel']) {
      const cache = await caches.open(name);
      await cache.put(`/__cache_probe__/${name}`, new Response(name));
    }
    return {
      scopes: (await navigator.serviceWorker.getRegistrations()).map(item => item.scope),
      caches: await caches.keys(),
    };
  }, LEGACY_SW_SCOPES);
  expect(initial.scopes.slice().sort()).toEqual(LEGACY_SW_SCOPES.map(url).sort());
  for (const name of ['old-tool-cache-v1', 'other-old-cache', 'workbox-sentinel']) {
    expect(initial.caches).toContain(name);
  }
  await context.unroute(`**${preparation}`);
  return page;
}

async function expectMigration(page: Page) {
  await activeRootWorker(page);
  await expect.poll(() => page.evaluate(async () => ({
    scopes: (await navigator.serviceWorker.getRegistrations()).map(item => item.scope),
    caches: await caches.keys(),
    oldCaches: (await caches.keys()).filter(name => ['old-tool-cache-v1', 'other-old-cache'].includes(name)),
    sentinel: await (await caches.open('workbox-sentinel'))
      .match('/__cache_probe__/workbox-sentinel').then(item => item?.text()),
  })), { timeout: 30_000 }).toEqual(expect.objectContaining({
    scopes: [url('/')],
    caches: expect.arrayContaining(['workbox-sentinel']),
    oldCaches: [],
    sentinel: 'workbox-sentinel',
  }));
}


for (const path of ['/about/', '/en/about/']) {
  test(`c370-about chromium direct ${path} saves both about documents and reloads offline`, async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Complete service-worker request and response observations are Chromium-only.');
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    try {
      const page = await context.newPage();
      await observePwaStartup(page);
      await visit(page, path);
      await expect(page.locator('astro-island[component-export="PwaStartup"]')).toHaveCount(1);
      await expect(page.locator('[component-export="Workbench"], [component-export="ImageConverter"]')).toHaveCount(0);
      await activeRootWorker(page);
      await expect.poll(() => page.evaluate(async () => {
        const paths: string[] = [];
        for (const name of (await caches.keys()).filter(name => name.startsWith('workbox-precache'))) {
          for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
        }
        return paths.filter(path => path === '/about/' || path === '/en/about/').sort();
      })).toEqual(['/about/', '/en/about/']);
      await context.setOffline(true);
      for (const target of [path, path === '/about/' ? '/en/about/' : '/about/']) {
        const first = await page.goto(url(target));
        expect(first?.fromServiceWorker()).toBe(true);
        const response = await page.reload();
        await publicReady(page);
        expect(response?.status()).toBe(200);
        expect(response?.fromServiceWorker()).toBe(true);
        await expect(page.locator('#page-heading')).toHaveText(target === '/about/' ? 'runlocally について' : 'About runlocally');
      }
    } finally { await context.setOffline(false); await context.close(); }
  });

  test(`c370-about chromium direct ${path} migrates artificial legacy registrations and caches`, async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Artificial migration and complete service-worker observation use Chromium.');
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    try {
      const page = await stageOldState(context);
      await visit(page, path);
      await expectMigration(page);
      await expect(page.locator('astro-island[component-export="PwaStartup"]')).toHaveCount(1);
      await expect(page.locator('[component-export="Workbench"], [component-export="ImageConverter"]')).toHaveCount(0);
    } finally { await context.close(); }
  });
}
