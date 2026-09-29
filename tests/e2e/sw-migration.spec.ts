import { test, expect } from '@playwright/test';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { roundTrip } from './_helpers';
import { activeRootWorker, assertOperationSupport, origin, url, visit } from './_covenant-support';

test.beforeEach(assertOperationSupport);

test('chromium removes old registrations and caches while retaining current operations', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium');
  test.setTimeout(180_000);
  const context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true });
  const slugs = AVAILABLE_OPS.map(op => op.slug);
  const preparation = '/__migration_setup__/';
  try {
    await context.route(`**${preparation}`, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Migration preparation</title>' }));
    const page = await context.newPage();
    await page.goto(url(preparation));
    const initial = await page.evaluate(async slugs => {
      for (const slug of slugs) {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: `/${slug}/` });
        await new Promise<void>((resolve, reject) => {
          const wait = () => registration.active?.state === 'activated' ? resolve() : setTimeout(wait, 100);
          setTimeout(() => reject(new Error(`Registration did not activate: ${slug}`)), 30_000);
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
    }, slugs);
    for (const slug of slugs) expect(initial.scopes).toContain(url(`/${slug}/`));
    for (const name of ['old-tool-cache-v1', 'other-old-cache', 'workbox-sentinel']) expect(initial.caches).toContain(name);
    await context.unroute(`**${preparation}`);
    await visit(page, '/en/');
    await activeRootWorker(page);
    await expect.poll(() => page.evaluate(async () => ({
      scopes: (await navigator.serviceWorker.getRegistrations()).map(item => item.scope),
      caches: await caches.keys(),
    })), { timeout: 30_000 }).toEqual(expect.objectContaining({
      scopes: [url('/')],
      caches: expect.arrayContaining(['workbox-sentinel']),
    }));
    const cleaned = await page.evaluate(async () => ({
      scopes: (await navigator.serviceWorker.getRegistrations()).map(item => item.scope),
      caches: await caches.keys(),
      sentinel: await (await caches.open('workbox-sentinel')).match('/__cache_probe__/workbox-sentinel').then(item => item?.text()),
    }));
    expect(cleaned.scopes).toEqual([url('/')]);
    expect(cleaned.caches).not.toContain('old-tool-cache-v1');
    expect(cleaned.caches).not.toContain('other-old-cache');
    expect(cleaned.sentinel).toBe('workbox-sentinel');
    await roundTrip(page);
    for (const slug of new Set([...slugs, ...(JSON.parse(await readFile(join(process.cwd(), 'legacy/slugs.json'), 'utf8')) as string[])])) {
      const response = await context.request.get(new URL(`/${slug}/sw.js`, origin).href, { maxRedirects: 0 });
      expect(response.status(), slug).toBe(410);
      expect(response.headers().location, slug).toBeUndefined();
    }
  } finally { await context.close(); }
});
