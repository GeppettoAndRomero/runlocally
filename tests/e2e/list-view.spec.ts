import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import { ready, select } from './_helpers';

configure({ useWebWorkers: false });
const fixture = (name: string) => readFile(join(process.cwd(), 'tests/fixtures/zip', name));
const longName = 'long'.repeat(55) + '.txt';
async function longZip() {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(longName, new TextReader('content'));
  return Buffer.from(await (await writer.close()).arrayBuffer());
}
async function intake(page: Page, buffer: Buffer, name: string) {
  await page.locator('.workbench__picker input').setInputFiles({ name, mimeType: 'application/zip', buffer });
  // The selected tab can be any operation, so wait for the new source and the tabs rather than for the browse panel.
  await expect(page.locator('.workbench__filename')).toHaveText(name);
  await expect(page.locator('[data-op="browse"]')).toBeVisible();
  await expect(page.locator('.workbench__picker input')).toBeEnabled();
}
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

for (const locale of ['en', 'ja'] as const) for (const width of [360, 768, 1280]) for (const colorScheme of ['light', 'dark'] as const) {
  test(`${locale} ${width}px ${colorScheme} panels, pager, result`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    await page.goto(locale === 'en' ? '/en/' : '/');
    await ready(page);
    await intake(page, await longZip(), 'source'.repeat(50) + '.zip');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(4);
    const selected = page.locator('[role="tab"][aria-selected="true"]');
    const tabStyle = await selected.evaluate(node => { const s = getComputedStyle(node); return { weight: s.fontWeight, border: s.borderBottomWidth, color: s.borderBottomColor, background: s.backgroundColor }; });
    expect(Number(tabStyle.weight)).toBeGreaterThanOrEqual(700);
    expect(parseFloat(tabStyle.border)).toBeGreaterThan(0);
    expect(tabStyle.color).not.toBe('rgba(0, 0, 0, 0)');
    const hover = page.locator('[data-op="extract"]');
    const initialBackground = await hover.evaluate(node => getComputedStyle(node).backgroundColor);
    await hover.hover();
    await expect.poll(() => hover.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(initialBackground);
    await tabs.first().focus();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.first()).toBeFocused();
    for (const op of ['browse', 'extract', 'remove', 'fix-names'] as const) {
      await select(page, op);
      const panel = page.locator(`#panel-${op}`);
      await expect(panel).toBeVisible();
      const frames = await panel.evaluate(node => { const outer = getComputedStyle(node); const inner = getComputedStyle(node.querySelector('.app-card')!); return { border: outer.borderTopWidth, padding: outer.paddingTop, shadow: outer.boxShadow, innerBorder: inner.borderTopWidth }; });
      expect(frames).toEqual({ border: '0px', padding: '0px', shadow: 'none', innerBorder: '1px' });
      await noOverflow(page);
    }
    await expect(page.locator('#panel-browse .workbench__name').first()).toHaveText(longName);
    await expect(page.locator('#panel-browse .workbench__size').first()).toHaveText('7 B');
    await expect(page.locator('#panel-browse svg').first()).toHaveAttribute('aria-hidden', 'true');
    await select(page, 'remove');
    const checkbox = page.getByRole('checkbox', { name: new RegExp('^' + longName.replace('.', '\\.') + ': ') });
    await expect(checkbox).toBeChecked();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await expect(page.locator('#panel-remove [data-keep-state="unchecked"]')).toHaveCount(1);
    expect((await checkbox.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await select(page, 'extract');
    const radio = page.getByRole('radio').last();
    await radio.check();
    await expect(page.getByRole('combobox').last()).toBeVisible();
    for (const control of [radio.locator('..'), page.getByRole('combobox').last()]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#panel-extract .app-button--primary').click();
    const result = page.locator('article.workbench__result').first();
    await expect(result).toBeVisible();
    await expect(result.locator('.workbench__result-source')).toContainText('source'.repeat(50));
    await expect(result.getByRole('button')).toHaveCount(2);
    await noOverflow(page);
  });
}

test('repair preview wraps and directory selection shows a mixed native checkbox', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/en/'); await ready(page);
  await intake(page, await fixture('rewrite/mojibake.zip'), 'mojibake.zip');
  await select(page, 'fix-names');
  await expect(page.locator('#panel-fix-names .workbench__repair-row').first()).toContainText('Candidate:');
  await noOverflow(page);
  // remove-sample.zip has a docs/ directory entry with a child, unlike sample.zip.
  await intake(page, await fixture('rewrite/remove-sample.zip'), 'remove-sample.zip');
  await select(page, 'remove');
  await page.getByRole('checkbox', { name: 'docs/guide.txt: Keep' }).uncheck();
  const directory = page.getByRole('checkbox', { name: 'docs/: Keep' });
  await expect.poll(() => directory.evaluate((node: HTMLInputElement) => node.indeterminate)).toBe(true);
  await expect(page.locator('#panel-remove [data-keep-state="indeterminate"]')).toHaveCount(1);
});
