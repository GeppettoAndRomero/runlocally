import { test, expect } from '@playwright/test';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { ready, roundTrip } from './_helpers';
import { activeRootWorker, assertOperationSupport, offline, origin, publicPaths, publicPathSet, url, visit } from './_covenant-support';
import { zipHome, zipOp } from './_paths';

test.beforeEach(assertOperationSupport);

test('published pages, manifest and reporting path', async ({ page, context, browserName }) => {
  const manifestResponse = await context.request.get(url('/manifest.webmanifest'));
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect([manifest.id, manifest.start_url, manifest.scope]).toEqual(['/', '/', '/']);
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#4f46e5');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((item: { sizes: string }) => item.sizes === `${size}x${size}`);
    expect(icon?.src).toBe(`/icons/app-${size}.png`);
    const response = await context.request.get(url(icon.src));
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    const bytes = await response.body();
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  const security = await context.request.get(url('/SECURITY.md'));
  expect(security.ok()).toBe(true);
  const securityText = await security.text();
  expect(securityText).toContain('Report a vulnerability');
  expect(securityText).toContain('security@runlocally.app');
  for (const path of publicPaths) {
    await visit(page, path);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', manifest.theme_color);
    await expect(page.locator('#footer-security')).toHaveAttribute('href', '/SECURITY.md');
  }
  await activeRootWorker(page);
  if (browserName === 'chromium') {
    const session = await context.newCDPSession(page);
    try {
      const result = await session.send('Page.getInstallabilityErrors');
      expect(result.installabilityErrors).toEqual([]);
    } finally { await session.detach(); }
  }
});

test('session URLs and offline operations', async ({ browser, browserName }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true });
  const changes: string[] = [];
  const page = await context.newPage();
  await context.exposeBinding('__recordPageUrl', (_source, value: string) => { changes.push(value); });
  await context.addInitScript(() => {
    const record = () => { void (window as typeof window & { __recordPageUrl: (value: string) => Promise<void> }).__recordPageUrl(location.href); };
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (...args) => { push(...args); record(); };
    history.replaceState = (...args) => { replace(...args); record(); };
    window.addEventListener('popstate', record);
    window.addEventListener('hashchange', record);
    record();
  });
  const clean = () => {
    expect(changes.length, 'recorded URL changes').toBeGreaterThan(0);
    for (const value of changes) {
      const current = new URL(value);
      expect(current.origin).toBe(origin);
      expect(publicPathSet.has(current.pathname), value).toBe(true);
      expect(current.search, value).toBe('');
      expect(current.hash, value).toBe('');
    }
  };
  try {
    await visit(page, zipHome('en'));
    await roundTrip(page, clean);
    const beforeLanguage = changes.length;
    await page.getByLabel('Language').selectOption('ja');
    expect(changes.length, 'language change is recorded').toBeGreaterThan(beforeLanguage);
    clean();
    await page.goBack(); await ready(page); clean();
    await page.goForward(); await ready(page); clean();
    for (const locale of LOCALES) for (const op of AVAILABLE_OPS) {
      await visit(page, zipOp(locale.code, op.id)); clean();
    }
    if (browserName === 'chromium') {
      await visit(page, zipHome('en'));
      await activeRootWorker(page);
      await offline(context, async () => {
        for (const path of publicPaths) { await visit(page, path); clean(); }
        await visit(page, zipHome('en'));
        await page.reload(); await ready(page);
        await roundTrip(page, clean);
      });
    }
    clean();
  } finally { await context.setOffline(false); await context.close(); }
});
