import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LEGACY_SW_SCOPES } from '../fixtures/sw/legacy';
import { roundTrip } from './_helpers';
import { activeRootWorker, assertOperationSupport, origin, url, visit } from './_covenant-support';
import { zipHome } from './_paths';

test.beforeEach(assertOperationSupport);

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

test('chromium removes old registrations and caches while retaining current operations', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium');
  test.setTimeout(540_000);
  for (const { name, firstVisit } of [
    { name: 'English ZIP entry', firstVisit: zipHome('en') },
    { name: 'Japanese hub', firstVisit: '/' },
    { name: 'English hub', firstVisit: '/en/' },
  ]) {
    await test.step(name, async () => {
      const context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true });
      try {
        const page = await stageOldState(context);
        await visit(page, firstVisit);
        await expectMigration(page);
        if (firstVisit !== zipHome('en')) await visit(page, zipHome('en'));
        await roundTrip(page);
      } finally { await context.close(); }
    });
  }
});

test('historical worker script URLs return 410 without redirecting', async ({ request }) => {
  const slugs = JSON.parse(await readFile(join(process.cwd(), 'legacy/slugs.json'), 'utf8')) as string[];
  const paths = new Set([
    ...slugs.map(slug => `/${slug}/sw.js`),
    ...LEGACY_SW_SCOPES.map(scope => `${scope}sw.js`),
  ]);
  for (const path of paths) {
    const response = await request.get(new URL(path, origin).href, { maxRedirects: 0 });
    expect(response.status(), path).toBe(410);
    expect(response.headers().location, path).toBeUndefined();
  }
});
