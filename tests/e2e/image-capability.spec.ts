import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { glob } from 'tinyglobby';
import { origin } from './_covenant-support';
import { imageProbeBytes, NATIVE_IMAGE_FORMATS } from '../../src/engine/image/probe';
const test = base.extend<{ egress: void }>({
  egress: [async ({ context }, use) => {
    const violations = await monitor(context);
    await use(undefined);
    expect(violations).toEqual([]);
  }, { auto: true }],
});
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


for (const path of ['/image/', '/en/image/']) {
  test(`capability samples, independent fixtures and stable hydration: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    // Hold island code so the initial SSR geometry can be measured before hydration.
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/ImageConverter.*.js', async route => { await blocked; await route.continue(); });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const geometry = () => page.evaluate(() => {
      const list = document.querySelector('.image-capability')!.getBoundingClientRect();
      const next = document.querySelector('.image-converter fieldset')!.getBoundingClientRect();
      return [list.x, list.y, list.width, list.height, next.y];
    });
    let initial: number[];
    try {
      await expect(page.locator('[data-state=checking]')).toHaveCount(7);
      initial = await geometry();
    } finally { release(); }
    await expect(page.locator('[data-state=checking]')).toHaveCount(0);
    expect(await geometry()).toEqual(initial);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const fixtures = ['alpha.png', 'oriented.jpg', 'animated.gif', 'alpha.webp', 'sample.bmp', 'sample.ico', 'sample.avif'];
    for (const [index, format] of NATIVE_IMAGE_FORMATS.entries()) {
      const bytes = [...await readFile(`tests/fixtures/image/${fixtures[index]}`)];
      const decode = (bytes: number[]) => page.evaluate(async bytes => {
        try {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]), { imageOrientation: 'from-image' });
          const valid = bitmap.width > 0 && bitmap.height > 0;
          bitmap.close(); return valid;
        } catch { return false; }
      }, bytes);
      const sample = await decode([...imageProbeBytes(format)]);
      expect(sample, `${format} sample and independent fixture disagree`).toBe(await decode(bytes));
      await expect(page.locator(`[data-format=${format}] dd`)).toHaveAttribute('data-state', sample ? 'readable' : 'unreadable');
    }
    await expect(page.locator('.capability-heic')).toContainText(path.startsWith('/en') ? 'built-in on-device decoder' : '端末内の内蔵デコーダ');
    await expect(page.locator('.image-capability li')).toHaveCount(0);
    await expect(page.locator('.image-converter input[type=file]')).toBeEnabled();
  });
}
