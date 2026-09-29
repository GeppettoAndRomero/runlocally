import { expect, type BrowserContext, type Page } from '@playwright/test';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS, type AvailableOpId } from '../../src/i18n/ops';
import { pagePath, type PublicPage } from '../../src/seo/page';
import { ready } from './_helpers';

export const origin = new URL(process.env.BASE_URL || 'http://localhost:8788').origin;
export const publicPaths = LOCALES.flatMap(locale =>
  (['top', ...AVAILABLE_OPS.map(op => op.id)] as PublicPage[]).map(page => pagePath(locale.code, page)));
export const publicPathSet = new Set(publicPaths);
export const fixtures: Record<AvailableOpId, readonly string[]> = {
  browse: ['zip/sample.zip', 'archive/sample.7z', 'zip/nested.zip'],
  extract: ['zip/sample.zip', 'archive/sample.7z', 'zip/nested.zip'],
  remove: ['zip/sample.zip'],
  'fix-names': ['zip/rewrite/mojibake.zip'],
};
export async function assertOperationSupport() {
  expect(Object.keys(fixtures).sort(), 'Every available operation needs fixtures').toEqual(AVAILABLE_OPS.map(op => op.id).sort());
  for (const paths of Object.values(fixtures)) {
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) await access(join(process.cwd(), 'tests/fixtures', path));
  }
}
export function url(path: string) { return new URL(path, origin).href; }
export async function visit(page: Page, path: string) {
  await page.goto(url(path));
  await ready(page);
}
export async function activeRootWorker(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return registration?.scope === `${location.origin}/` && registration.active?.state === 'activated' &&
      new URL(registration.active.scriptURL).pathname === '/sw.js';
  }), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('workbox-precache'));
    for (const name of names) {
      const keys = await (await caches.open(name)).keys();
      const paths = keys.map(key => new URL(key.url).pathname);
      if (paths.includes('/vendor/libarchive/libarchive.wasm') && paths.includes('/vendor/libarchive/worker-bundle.js')) return true;
    }
    return false;
  }), { timeout: 60_000 }).toBe(true);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload(); await ready(page);
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const registration = await page.evaluate(async () => {
    const item = await navigator.serviceWorker.getRegistration('/');
    return { scope: item?.scope, script: item?.active?.scriptURL, state: item?.active?.state };
  });
  expect(registration).toEqual({ scope: url('/'), script: url('/sw.js'), state: 'activated' });
}
export async function offline(context: BrowserContext, run: () => Promise<void>) {
  await context.setOffline(true);
  try { await run(); } finally { await context.setOffline(false); }
}
