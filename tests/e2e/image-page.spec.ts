import { expect, test as base, type BrowserContext, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { glob } from 'tinyglobby';
import { origin } from './_covenant-support';

const test = base.extend<{ egress: void }>({
  egress: [async ({ context }, use) => {
    const violations = await monitor(context);
    await use(undefined);
    expect(violations).toEqual([]);
  }, { auto: true }],
});

const fixture = (name: string) => `tests/fixtures/image/${name}`;
async function ready(page: Page) {
  await page.waitForFunction(() => window.__toolReady === true);
}
async function pixels(page: Page, download: Download, format: 'jpg' | 'png', dimensions = [32, 24]) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  expect([...bytes.subarray(0, format === 'jpg' ? 3 : 8)]).toEqual(format === 'jpg'
    ? [255, 216, 255] : [137, 80, 78, 71, 13, 10, 26, 10]);
  const result = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0); bitmap.close();
    return { size: [canvas.width, canvas.height], pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  }, [...bytes]);
  expect(result.size).toEqual(dimensions);
  expect(new Set(result.pixels).size).toBeGreaterThan(10);
  return result.pixels;
}

// Attach at context level before opening any document: includes dedicated worker
// requests and SW requests. No fixture name or image bytes are allowed on the wire.
async function monitor(context: BrowserContext) {
  const violations: string[] = [];
  const sw = await readFile('dist/sw.js', 'utf8');
  const revisions = new Map([...sw.matchAll(/url:"([^"]+)"[^}]*?revision:"([^"]+)"/g)]
    .map(([, path, revision]) => [new URL(path, origin).pathname, revision]));
  const known = new Set((await glob('dist/**/*')).map(path => `/${path.slice(5)}`));
  for (const path of [...known]) if (path.endsWith('/index.html')) known.add(path.slice(0, -10));
  context.on('request', request => {
    const url = new URL(request.url());
    // A blob: URL points at bytes already in the page (the saved file); it never reaches the network.
    if (url.protocol === 'blob:') return;
    const query = !url.search || (url.searchParams.size === 1 &&
      url.searchParams.get('__WB_REVISION__') === revisions.get(url.pathname));
    // No header may carry a file name or a large encoded payload.
    const names = ['alpha', 'sample', 'oriented', 'animated', 'old', 'dup'];
    const leaks = Object.entries(request.headers()).some(([key, value]) =>
      value.length > 2048 || names.some(name => key.includes(name) || (key !== 'referer' && key !== 'cookie' && value.includes(`${name}.`))));
    if (leaks) violations.push(`header ${request.url()}`);
    if (url.origin !== origin || !known.has(url.pathname) || !query || url.hash ||
      !['GET', 'HEAD'].includes(request.method()) || request.postData() !== null) {
      violations.push(`${request.method()} ${request.url()}`);
    }
  });
  const watchPage = (page: Page) => page.on('websocket', socket => violations.push(`WebSocket ${socket.url()}`));
  context.pages().forEach(watchPage);
  context.on('page', watchPage);
  await context.routeWebSocket('**/*', socket => { violations.push(`WebSocket ${socket.url()}`); socket.close(); });
  return violations;
}

test('real image page downloads JPG and PNG, preserves duplicate inputs and composites white', async ({ page }) => {
  await page.goto('/image/'); await ready(page);
  await expect(page.locator('astro-island[component-export="ImageConverter"]')).toHaveCount(1);
  await expect(page.locator('astro-island[component-export="PwaStartup"]')).toHaveCount(0);
  const jpg = page.waitForEvent('download');
  await page.locator('input[type=file]').setInputFiles(fixture('alpha.png'));
  const first = await jpg;
  expect(first.suggestedFilename()).toBe('alpha.jpg');
  const data = await pixels(page, first, 'jpg');
  // Centre of the fully transparent left band: JPEG chroma error is allowed.
  for (const channel of data.slice((12 * 32 + 2) * 4, (12 * 32 + 2) * 4 + 3)) expect(channel).toBeGreaterThan(235);
  await expect(page.locator('input[value=png]')).toBeEnabled();
  await page.locator('input[value=png]').check();
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  const buffer = await readFile(fixture('alpha.png'));
  const duplicate = { name: 'private-input.png', mimeType: 'image/png', buffer };
  await page.locator('input[type=file]').setInputFiles([duplicate, duplicate]);
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map(download => download.suggestedFilename())).toEqual(['private-input.png', 'private-input(1).png']);
  for (const download of downloads) {
    const actual = await pixels(page, download, 'png');
    expect(actual[3]).toBe(0);
    expect(actual.slice((12 * 32 + 28) * 4, (12 * 32 + 28) * 4 + 4)).toEqual([224, 120, 0, 255]);
  }
  await expect(page.locator('input[value=jpg]')).toBeEnabled();
});

test('multiple different inputs produce matching individual downloads', async ({ page }) => {
  await page.goto('/image/'); await ready(page);
  await page.locator('input[value=png]').check();
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  await page.locator('input[type=file]').setInputFiles([fixture('alpha.png'), fixture('oriented.jpg')]);
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map(download => download.suggestedFilename())).toEqual(['alpha.png', 'oriented.png']);
  const alpha = await pixels(page, downloads[0], 'png');
  const oriented = await pixels(page, downloads[1], 'png', [24, 32]);
  expect(alpha[3]).toBe(0);
  expect(oriented[3]).toBe(255);
  expect(oriented).not.toEqual(alpha);
});

test('locks output while processing and while more input is queued', async ({ page }) => {
  // Hold an actual worker script request; release it by handshake, not a timer.
  let release!: () => void;
  let requested!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/image-worker-*.js', async route => { requested(); await blocked; await route.continue(); });
  await page.goto('/image/'); await ready(page);
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  try {
    await page.locator('input[type=file]').setInputFiles(fixture('alpha.png'));
    await started;
    await page.locator('input[type=file]').setInputFiles(fixture('alpha.webp'));
    await expect(page.locator('input[value=png]')).toBeDisabled();
    await expect(page.locator('.image-converter li')).toHaveCount(2);
  } finally { release(); }
  await expect.poll(() => downloads.length).toBe(2);
  await expect(page.locator('input[value=png]')).toBeEnabled();
});

test('HEIC follows the browser decode path on the real page', async ({ page, browserName }) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto('/image/'); await ready(page);
  await page.locator('input[value=png]').check();
  const pending = page.waitForEvent('download');
  await page.locator('input[type=file]').setInputFiles(fixture('sample.heic'));
  const download = await pending;
  // Whether the browser decodes HEIC itself depends on its build and platform, so ask it.
  const bytes = [...await readFile(fixture('sample.heic'))];
  const native = await page.evaluate(async bytes => {
    try { (await createImageBitmap(new Blob([new Uint8Array(bytes)]))).close(); return true; } catch { return false; }
  }, bytes);
  const data = await pixels(page, download, 'png', [240, 240]);
  for (const [index, expected] of [1, 1, 3].entries()) expect(Math.abs(data[index] - expected)).toBeLessThanOrEqual(6);
  expect(data[3]).toBe(255);
  expect(workers.some(url => /image-worker-/.test(url))).toBe(true);
  const rescue = workers.some(url => /heic-worker-/.test(url));
  test.info().annotations.push({ type: 'decode-path', description: `${browserName}: ${rescue ? 'WASM worker' : 'native'}` });
  expect(rescue, `${browserName} native HEIC support: ${native}; the WASM worker must run exactly when it is missing`).toBe(!native);
});

test('first HEIC conversion works offline after cold precache and reload', async ({ context, page, browserName }) => {
  // Automated WebKit fails an offline reload with an internal error, as the other offline specs also avoid it.
  test.skip(browserName === 'webkit', 'Offline reload is not supported by automated WebKit; offline behavior is unverified there.');
  const assets = (await glob('dist/_astro/{image-worker,heic-worker}-*.js')).map(path => `/${path.slice(5)}`);
  expect(assets).toHaveLength(2);
  assets.push('/vendor/libheif/libheif.wasm');
  const served: string[] = [];
  context.on('response', response => {
    if (response.fromServiceWorker()) served.push(new URL(response.url()).pathname);
  });
  await page.goto('/image/'); await ready(page);
  await page.waitForFunction(async assets => {
    await navigator.serviceWorker.ready;
    const saved: string[] = [];
    for (const name of (await caches.keys()).filter(name => name.startsWith('workbox-precache'))) {
      saved.push(...(await (await caches.open(name)).keys()).map(key => new URL(key.url).pathname));
    }
    return assets.every(path => saved.includes(path));
  }, assets);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  try {
    expect((await page.reload())?.fromServiceWorker()).toBe(true); await ready(page);
    await page.locator('input[value=png]').check();
    const pending = page.waitForEvent('download');
    await page.locator('input[type=file]').setInputFiles(fixture('sample.heic'));
    await pixels(page, await pending, 'png', [240, 240]);
    // Chromium/Firefox execute WASM; native WebKit needs only the image worker.
    for (const path of assets.filter(path => browserName !== 'webkit' || path.includes('/image-worker-'))) expect(served).toContain(path);
  } finally { await context.setOffline(false); }
});

test('both image pages fit a 360px viewport and contain current application metadata', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/image/', '/en/image/']) {
    await page.goto(path); await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.featureList).toEqual(['JPG', 'PNG']);
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex');
  }
});
