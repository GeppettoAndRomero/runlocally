import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ready } from './_helpers';

const widths = [360, 768, 1280];
const themes = ['light', 'dark'] as const;
const locales = ['ja', 'en'] as const;
const sample = () => readFile(join(process.cwd(), 'tests/fixtures/zip/sample.zip'));
async function overflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
for (const locale of locales) for (const width of widths) for (const colorScheme of themes) {
  test(`${locale} ${width}px ${colorScheme} input states`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    await page.goto(locale === 'ja' ? '/' : '/en/');
    await ready(page);
    const picker = page.locator('label.workbench__picker');
    const input = picker.locator('input[type="file"]');
    await expect(picker).toBeVisible();
    await expect(input).toHaveAttribute('aria-describedby', 'workbench-drop-hint');
    expect(await input.evaluate((node: HTMLInputElement) => node.labels?.[0] === node.closest('label'))).toBe(true);
    await expect(page.locator('.workbench__empty')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Reset|リセット):/ })).toHaveCount(0);
    await expect.poll(() => overflow(page)).toBe(0);
    await input.setInputFiles({ name: 'a-very-long-source-archive-name-for-layout-check.zip', mimeType: 'application/zip', buffer: await sample() });
    await expect(page.locator('.workbench__filename')).toHaveText('a-very-long-source-archive-name-for-layout-check.zip');
    await expect(page.getByRole('button', { name: /^(Reset|リセット):/ })).toBeVisible();
    await expect(page.locator('#panel-browse [role="listitem"]').first()).toBeVisible();
    await expect(input).toBeEnabled();
    await expect.poll(() => overflow(page)).toBe(0);
    await page.locator('[data-op=extract]').click();
    await page.locator('#panel-extract button').last().click();
    await expect(page.locator('article.workbench__result')).toHaveCount(1);
    await expect(page.locator('.workbench__empty')).toHaveCount(0);
    await expect.poll(() => overflow(page)).toBe(0);
    await page.getByRole('button', { name: /^(Reset|リセット):/ }).click();
    await input.setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect.poll(() => overflow(page)).toBe(0);
    await page.getByRole('button', { name: /^(Reset|リセット):/ }).click();
    await expect(page.locator('.workbench__empty')).toBeVisible();
    await expect.poll(() => overflow(page)).toBe(0);
  });
}
test('DOM drop and document paste each accept one archive', async ({ page }) => {
  await page.goto('/en/'); await ready(page);
  const data = [...await sample()];
  await page.evaluate(() => {
    const counts = { dropped: 0, processed: 0 };
    (window as unknown as { __intake: typeof counts }).__intake = counts;
    window.addEventListener('filesDropped', () => { counts.dropped++; });
    window.addEventListener('filesProcessed', () => { counts.processed++; });
  });
  const intake = () => page.evaluate(() => (window as unknown as { __intake: { dropped: number; processed: number } }).__intake);
  await page.evaluate(bytes => {
    const file = new File([new Uint8Array(bytes)], 'dropped.zip');
    const transfer = new DataTransfer(); transfer.items.add(file);
    document.querySelector('.workbench__picker')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, data);
  await expect(page.locator('.workbench__filename')).toHaveText('dropped.zip');
  // Input is ignored while the first archive is still being read; wait for its listing to finish.
  await expect(page.locator('[data-op="browse"]')).toBeVisible();
  await expect.poll(intake).toEqual({ dropped: 1, processed: 1 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(bytes => {
    const file = new File([new Uint8Array(bytes)], 'pasted.zip');
    const transfer = new DataTransfer(); transfer.items.add(file);
    const paste = new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer });
    // Firefox ignores clipboardData in the constructor; attach it when the event came out without the file.
    if (!paste.clipboardData || paste.clipboardData.items.length === 0) Object.defineProperty(paste, 'clipboardData', { value: transfer });
    document.dispatchEvent(paste);
  }, data);
  await expect(page.locator('.workbench__filename')).toHaveText('pasted.zip');
  await expect.poll(intake).toEqual({ dropped: 2, processed: 2 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('follows a color scheme change without reloading', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/en/'); await ready(page);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(background).not.toBe(light);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(background).toBe(light);
});
