import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { origin } from './_covenant-support';

// Route gates must see worker scripts instead of a service worker cache response.
test.use({ serviceWorkers: 'block' });

for (const locale of ['ja', 'en'] as const) for (const motion of ['no-preference', 'reduce'] as const) {
  test(`real worker progress in ${locale}, motion ${motion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    const violations: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.protocol !== 'blob:' && (url.origin !== origin ||
        !['GET', 'HEAD'].includes(request.method()) || request.postData() !== null)) violations.push(request.url());
    });
    // Gates pause real browser operations without replacing their results.
    await page.route('**/image-worker-*.js', async route => {
      const response = await route.fetch();
      const gate = `
        const bitmap = self.createImageBitmap.bind(self);
        self.createImageBitmap = async (...args) => {
          await new Promise(resolve => { self.releaseDecode = resolve; });
          return bitmap(...args);
        };
        const encode = OffscreenCanvas.prototype.convertToBlob;
        OffscreenCanvas.prototype.convertToBlob = async function(...args) {
          await new Promise(resolve => { self.releaseEncode = resolve; });
          return encode.apply(this, args);
        };
      `;
      await route.fulfill({ response, body: gate + await response.text() });
    });
    await page.goto(locale === 'ja' ? '/image/' : '/en/image/');
    await page.waitForFunction(() => window.__toolReady === true);
    const workerStarted = page.waitForEvent('worker', worker => /image-worker-/.test(worker.url()));
    await page.locator('input[type=file]').setInputFiles('tests/fixtures/image/alpha.png');
    const worker = await workerStarted;
    const progress = page.locator('.progress-panel progress');
    await expect(progress).toHaveAttribute('value', '0'); await expect(progress).toHaveAttribute('max', '1');
    await expect(progress).toHaveAttribute('aria-label', locale === 'ja' ? '変換の進捗' : 'Conversion progress');
    await expect(page.locator('.progress-panel p')).toContainText(locale === 'ja' ? 'デコード中' : 'Decoding');
    const decoration = page.locator('.progress-panel__stages');
    await expect(decoration).toHaveAttribute('aria-hidden', 'true');
    expect(await page.locator('.progress-panel p').evaluate(node => node.closest('[aria-live], [role=status]') === null)).toBe(true);
    const style = await decoration.locator('span').first().evaluate(node => ({
      animation: getComputedStyle(node, '::after').animationName,
      transition: getComputedStyle(node, '::before').transitionDuration,
    }));
    expect(style.animation).toBe(motion === 'reduce' ? 'none' : 'image-stage-highlight');
    expect(style.transition).toBe(motion === 'reduce' ? '0s' : '0.12s');
    await expect.poll(() => worker.evaluate(() => typeof Reflect.get(self, 'releaseDecode'))).toBe('function');
    await worker.evaluate(() => Reflect.get(self, 'releaseDecode')());
    await expect(page.locator('.progress-panel p')).toContainText(locale === 'ja' ? 'エンコード中' : 'Encoding');
    await expect(progress).toHaveAttribute('value', '0');
    await expect.poll(() => worker.evaluate(() => typeof Reflect.get(self, 'releaseEncode'))).toBe('function');
    const download = page.waitForEvent('download');
    await worker.evaluate(() => Reflect.get(self, 'releaseEncode')()); await download;
    await expect(page.locator('.progress-panel')).toHaveCount(0);
    await expect(page.locator('.image-converter li')).toHaveCount(1);
    expect(violations).toEqual([]);
  });
}

test('main-thread adapters deliver stages with a caller-created canvas', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'image-progress-'));
  const entry = resolve('src/engine/image/__progress-harness.ts');
  try {
    await build({ configFile: false, publicDir: false, logLevel: 'error',
      plugins: [{ name: 'progress-harness', resolveId: id => id === entry ? entry : undefined,
        load: id => id === entry ? `
          import { convertImage, decodeNativeImage, mainThreadImageCanvas } from './convert';
          export async function run(bytes) {
            const stages = [];
            const result = await convertImage(new Blob([new Uint8Array(bytes)]), 'png', {
              decode: decodeNativeImage, canvas: mainThreadImageCanvas(() => document.createElement('canvas')),
              onStage: stage => stages.push(stage)
            });
            return { ok: result.ok, stages };
          }
        ` : undefined }],
      build: { outDir: directory, emptyOutDir: true,
        rollupOptions: { input: entry, preserveEntrySignatures: 'strict', output: { entryFileNames: 'harness.js' } } } });
    const script = await readFile(join(directory, 'harness.js'), 'utf8');
    await page.route('**/progress-harness.js', route => route.fulfill({ contentType: 'text/javascript', body: script }));
    await page.goto('/image/');
    const bytes = [...await readFile('tests/fixtures/image/alpha.png')];
    expect(await page.evaluate(async bytes => {
      const path = '/progress-harness.js';
      return (await import(path)).run(bytes);
    }, bytes)).toEqual({ ok: true, stages: ['reading', 'decoding', 'drawing', 'encoding'] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
