import { test, expect, type BrowserContext, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { pagePath } from '../../src/seo/page';
import { ready, roundTrip } from './_helpers';
import { zipHome } from './_paths';

const baseURL = process.env.BASE_URL || 'http://localhost:8788';
const origin = new URL(baseURL).origin;
const pages = new Set(LOCALES.flatMap(locale => ['top', ...AVAILABLE_OPS.map(op => op.id)].map(op => pagePath(locale.code, op as 'top' | typeof AVAILABLE_OPS[number]['id']))));
const fixed = new Set(['/sw.js', '/manifest.webmanifest', '/SECURITY.md']);
const asset = (path: string) => ['/_astro/', '/vendor/', '/icons/'].some(prefix => path.startsWith(prefix));

type Event = { url: string; method: string; owner: string; resourceType: string; operation: string; failure?: string; serviceWorkerResponse?: boolean };
function owner(request: Request): string {
  if (request.serviceWorker()) return 'service-worker';
  try { return request.frame().url() || 'frame'; } catch { return 'worker'; }
}
function recordUrl(raw: string) {
  try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return raw.split('?')[0].slice(0, 160); }
}
function allowed(request: Request, revisions: Map<string, string>) {
  let url: URL;
  try { url = new URL(request.url()); } catch { return 'invalid URL'; }
  if (url.protocol === 'blob:') return null;
  if (url.origin !== origin) return 'foreign origin';
  if (!['GET', 'HEAD'].includes(request.method()) || request.postData() !== null) return 'outbound body or method';
  if (url.hash) return 'fragment';
  if (url.search && !(url.searchParams.size === 1 &&
    url.searchParams.has('__WB_REVISION__') &&
    revisions.get(url.pathname) === url.searchParams.get('__WB_REVISION__'))) return 'unknown query';
  if (!pages.has(url.pathname) && !fixed.has(url.pathname) && !asset(url.pathname)) return 'unknown path';
  return null;
}
async function revisionsFromBuild() {
  const sw = process.env.BASE_URL ? await (await fetch(new URL('/sw.js', baseURL))).text() : await readFile('dist/sw.js', 'utf8');
  const map = new Map<string, string>();
  for (const match of sw.matchAll(/(?:url:|"url":)"([^"]+)"[^}]*?(?:revision:|"revision":)"([^"]+)"/g)) {
    map.set(new URL(match[1], origin).pathname, match[2]);
  }
  return map;
}
async function monitor(context: BrowserContext, revisions: Map<string, string>) {
  const events: Event[] = [];
  const eventByRequest = new WeakMap<Request, Event>();
  const violations: string[] = [];
  let operation = 'initial load';
  context.on('request', request => {
    const event: Event = { url: recordUrl(request.url()), method: request.method(), owner: owner(request), resourceType: request.resourceType(), operation };
    events.push(event);
    eventByRequest.set(request, event);
    const reason = allowed(request, revisions);
    if (reason) violations.push(`${reason}: ${event.method} ${event.url} (${event.owner}, ${operation})`);
  });
  context.on('requestfailed', request => {
    const event = eventByRequest.get(request);
    if (event) event.failure = request.failure()?.errorText || 'failed';
  });
  context.on('response', response => {
    const event = eventByRequest.get(response.request());
    if (event) event.serviceWorkerResponse = response.fromServiceWorker();
  });
  context.on('page', page => page.on('websocket', socket => {
    violations.push(`WebSocket: ${recordUrl(socket.url())} (${operation})`);
  }));
  await context.route('**/*', async route => {
    const reason = allowed(route.request(), revisions);
    if (reason) await route.abort();
    else await route.continue();
  });
  return {
    events, violations,
    setOperation(value: string) { operation = value; },
    assertClean() { expect(violations, 'Unexpected browser communication').toEqual([]); },
    async stop() { await context.unroute('**/*'); },
  };
}
async function precached(context: BrowserContext, page: import('@playwright/test').Page) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (registration.active?.state !== 'activated') return false;
    const cacheNames = await caches.keys();
    for (const name of cacheNames.filter(name => name.startsWith('workbox-precache'))) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      if (keys.some(request => new URL(request.url).pathname === '/vendor/libarchive/libarchive.wasm') &&
          keys.some(request => new URL(request.url).pathname === '/vendor/libarchive/worker-bundle.js')) return true;
    }
    return false;
  }, undefined, { timeout: 60_000 });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) { await page.reload(); await ready(page); }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  expect(context.serviceWorkers().length).toBeGreaterThan(0);
}

test('online operations and observed communication', async ({ browser: engine, browserName }) => {
  test.info().annotations.push({ type: 'capability', description: browserName === 'chromium'
    ? 'Online requests, service-worker requests and precache observed.'
    : 'Online operations and observable requests checked; service-worker requests and offline operations require device verification.' });
  const context = await engine.newContext({ serviceWorkers: 'allow', acceptDownloads: true });
  const monitorState = await monitor(context, await revisionsFromBuild());
  try {
    const page = await context.newPage();
    await page.goto(new URL(zipHome('en'), origin).href);
    await ready(page);
    if (browserName === 'chromium') {
      await precached(context, page);
      expect(monitorState.events.some(event => event.owner === 'service-worker' &&
        event.url.endsWith('/vendor/libarchive/libarchive.wasm')), 'precache must issue an observable vendor request').toBe(true);
    }
    monitorState.setOperation('online round trip');
    await roundTrip(page, monitorState.assertClean);
    for (const archive of ['sample.zip', 'sample.7z']) {
      const card = page.locator('article.workbench__result')
        .filter({ has: page.getByText(`Source file: ${archive}`, { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Save file: readme.txt' }) });
      await expect(card, `${archive} must retain its own readme.txt result`).toHaveCount(1);
    }
    monitorState.assertClean();
  } finally {
    await test.info().attach('network-events.json', { body: Buffer.from(JSON.stringify(monitorState.events, null, 2)), contentType: 'application/json' });
    monitorState.assertClean(); await monitorState.stop(); await context.close();
  }
});

test('chromium: offline repeats the same operations', async ({ browser, browserName }) => {
  // The offline contract includes observing service-worker requests during precache
  // and reload; Playwright exposes those requests only in Chromium.
  test.skip(browserName !== 'chromium');
  const context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true });
  const monitorState = await monitor(context, await revisionsFromBuild());
  try {
    const page = await context.newPage();
    await page.goto(new URL(zipHome('en'), origin).href);
    await ready(page);
    await precached(context, page);
    monitorState.setOperation('online round trip');
    await roundTrip(page, monitorState.assertClean);
    monitorState.assertClean();
    await context.setOffline(true);
    const offlineStart = monitorState.events.length;
    monitorState.setOperation('offline reload and round trip');
    await page.reload();
    await ready(page);
    await roundTrip(page, monitorState.assertClean);
    monitorState.assertClean();
    const offlineEvents = monitorState.events.slice(offlineStart).filter(event => event.owner !== 'service-worker');
    const offlinePages = offlineEvents.filter(event => event.resourceType === 'document' && pages.has(new URL(event.url).pathname));
    const offlineAssets = offlineEvents.filter(event => asset(new URL(event.url).pathname));
    expect(offlinePages.length, 'offline page requests must be observed').toBeGreaterThan(0);
    expect(offlineAssets.length, 'offline asset requests must be observed').toBeGreaterThan(0);
    for (const event of [...offlinePages, ...offlineAssets]) {
      expect(event.failure, `offline request failed: ${event.url}`).toBeUndefined();
      expect(event.serviceWorkerResponse, `offline response must come from the service worker: ${event.url}`).toBe(true);
    }
  } finally {
    await test.info().attach('network-events.json', { body: Buffer.from(JSON.stringify(monitorState.events, null, 2)), contentType: 'application/json' });
    await context.setOffline(false); monitorState.assertClean(); await monitorState.stop(); await context.close();
  }
});

test('chromium: monitor rejects page and service-worker probes', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium');
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const monitorState = await monitor(context, await revisionsFromBuild());
  try {
    const page = await context.newPage();
    await page.goto(new URL(zipHome('en'), origin).href);
    await precached(context, page);
    monitorState.setOperation('isolated probe');
    await page.evaluate(() => fetch('/__egress_probe__', { method: 'POST', body: 'probe' }).catch(() => undefined));
    await context.serviceWorkers()[0].evaluate(() => fetch('/__egress_probe__').catch(() => undefined));
    expect(monitorState.violations.some(value => value.includes('outbound body or method'))).toBe(true);
    expect(monitorState.violations.some(value => value.includes('service-worker'))).toBe(true);
  } finally { await monitorState.stop(); await context.close(); }
});
