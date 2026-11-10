import { expect, test } from '@playwright/test';
import { ready } from './_helpers';

// Served through the real Pages Functions runtime. The unit tests cover every form; this checks the route end to end.
const moved: [string, string][] = [
  ['/zip-viewer/', '/en/zip/view/'], ['/zip-viewer/ja/', '/zip/view/'],
  ['/unzip/', '/en/zip/extract/'], ['/unzip/ja/', '/zip/extract/'],
  ['/remove-from-zip/', '/en/zip/remove/'], ['/remove-from-zip/ja/', '/zip/remove/'],
  ['/zip-filename-fix/', '/en/zip/fix-names/'], ['/zip-filename-fix/ja/', '/zip/fix-names/'],
  ['/create-zip/', '/en/zip/create/'], ['/create-zip/ja/', '/zip/create/'],
];

for (const [from, to] of moved) {
  test(`${from} moves once to ${to} and the page opens`, async ({ page, request, baseURL }) => {
    const first = await request.get(`${from}?from=old`, { maxRedirects: 0 });
    expect(first.status()).toBe(301);
    expect(new URL(first.headers().location, baseURL).pathname + new URL(first.headers().location, baseURL).search).toBe(to);
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replaceAll('/', '\\/')}$`));
    await ready(page);
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
  });
}

test('the old worker scripts and the pages without a successor stay gone, with no redirect', async ({ request }) => {
  for (const path of ['/zip-viewer/sw.js', '/zip-viewer/ja/sw.js', '/unzip/sw.js', '/en/zip-viewer/', '/zip-viewer/zh/', '/recover-zip/', '/split-zip/']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([path, response.status(), 'location' in response.headers()]).toEqual([path, 410, false]);
  }
});
