import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { AVAILABLE_OPS, type AvailableOpId } from '../../src/i18n/ops';
import type { Locale } from '../../src/i18n/locales';
import { ui as enUi } from '../../src/i18n/en/ui';
import { ui as jaUi } from '../../src/i18n/ja/ui';
import { drop, ready } from './_helpers';
import { zipHome, zipOp } from './_paths';

const copy = { en: enUi, ja: jaUi };
const tabs = (page: Page) => page.getByRole('tab');
const tab = (page: Page, locale: Locale, op: (typeof AVAILABLE_OPS)[number]) =>
  page.getByRole('tab', { name: copy[locale].menu[op.i18nKey].verb, exact: true });
const noOverflow = async (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
async function selected(page: Page, locale: Locale, id: AvailableOpId) {
  const op = AVAILABLE_OPS.find(entry => entry.id === id)!;
  await expect(tab(page, locale, op)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`#panel-${id}`)).toBeVisible();
  await expect(page.locator(`[data-chrome-page="${id}"]`)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(new RegExp(`${zipOp(locale, id)}$`));
}
async function menuContract(page: Page, locale: Locale) {
  await expect(tabs(page)).toHaveCount(AVAILABLE_OPS.length);
  expect(await tabs(page).allTextContents()).toEqual(AVAILABLE_OPS.map(op =>
    `${copy[locale].menu[op.i18nKey].verb}${copy[locale].menu[op.i18nKey].description}`));
  for (const op of AVAILABLE_OPS) {
    const item = tab(page, locale, op);
    const label = copy[locale].menu[op.i18nKey];
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('id', `tab-${op.id}`);
    await expect(item).toHaveAttribute('data-op', op.id);
    await expect(item).toHaveAttribute('aria-controls', `panel-${op.id}`);
    await expect(item).toHaveAttribute('aria-labelledby', `menu-verb-${op.id}`);
    await expect(item).toHaveAttribute('aria-describedby', `menu-description-${op.id}`);
    await expect(item).toHaveAccessibleName(label.verb);
    await expect(item).toHaveAccessibleDescription(label.description);
    await expect(item.locator('.workbench__menu-verb')).toHaveText(label.verb);
    await expect(item.locator('.workbench__menu-description')).toHaveText(label.description);
    await expect(page.locator(`#panel-${op.id}`)).toHaveAttribute('aria-labelledby', `tab-${op.id}`);
  }
}
async function noExecution(page: Page) {
  await expect(page.locator('article.workbench__result')).toHaveCount(0);
  await expect(page.locator('[role="tabpanel"] button, [role="tabpanel"] input, [role="tabpanel"] select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save file:/ })).toHaveCount(0);
}

for (const locale of ['en', 'ja'] as const) {
  test(`${locale} menu is present before input and direct operation visits`, async ({ page }) => {
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await page.goto(zipHome(locale)); await ready(page);
    await menuContract(page, locale);
    await noExecution(page);
    for (const op of AVAILABLE_OPS) {
      await tab(page, locale, op).click();
      await selected(page, locale, op.id);
      await expect(page.locator(`#panel-${op.id} .workbench__not-ready`)).toHaveText(copy[locale].workbench.choose);
      await noExecution(page);
      await page.goto(zipOp(locale, op.id)); await ready(page);
      await menuContract(page, locale);
      await selected(page, locale, op.id);
      await noExecution(page);
    }
    expect(downloads).toBe(0);
  });

  test(`${locale} switching operations retains source, listing and result`, async ({ page }) => {
    await page.goto(zipHome(locale)); await ready(page);
    await drop(page, 'zip/sample.zip');
    await expect(page.locator('.workbench__filename')).toHaveText('sample.zip');
    await tab(page, locale, AVAILABLE_OPS[1]).click();
    await selected(page, locale, 'extract');
    await page.getByRole('radio', { name: copy[locale].workbench.one }).check();
    await page.getByRole('combobox', { name: copy[locale].workbench.one }).selectOption('readme.txt');
    await page.getByRole('button', { name: `${copy[locale].workbench.run}: readme.txt` }).click();
    const card = page.locator('article.workbench__result').first();
    await expect(card).toBeVisible();
    for (const op of AVAILABLE_OPS) {
      await tab(page, locale, op).click();
      await selected(page, locale, op.id);
      await expect(page.locator('.workbench__filename')).toHaveText('sample.zip');
      await expect(card).toBeVisible();
      await expect(page.locator('#panel-browse [role="listitem"]')).toHaveCount(5);
    }
    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: `${copy[locale].workbench.saveFile}: readme.txt` }).click();
    const saved = await download;
    expect((await readFile((await saved.path())!)).toString('utf8')).toBe('hello from unzip\n');
  });

  test(`${locale} wide menu cycles in both axes`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(zipHome(locale)); await ready(page);
    const menu = page.locator('[data-workbench-menu]');
    await expect(menu).toHaveAttribute('aria-orientation', 'vertical');
    await expect.poll(async () => page.evaluate(() => {
      const menu = document.querySelector('[data-workbench-menu]')!.getBoundingClientRect();
      const workspace = document.querySelector('.workbench__workspace')!.getBoundingClientRect();
      return menu.right <= workspace.left;
    })).toBe(true);
    const first = tab(page, locale, AVAILABLE_OPS[0]);
    await first.focus();
    for (const [key, id] of [['ArrowUp', 'fix-names'], ['ArrowDown', 'browse'], ['ArrowLeft', 'fix-names'], ['ArrowRight', 'browse']] as const) {
      await page.keyboard.press(key);
      const target = tab(page, locale, AVAILABLE_OPS.find(op => op.id === id)!);
      await expect(target).toBeFocused();
      await selected(page, locale, id);
    }
  });

  test(`${locale} narrow menu wraps and keeps vertical scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto(zipHome(locale)); await ready(page);
    const menu = page.locator('[data-workbench-menu]');
    await expect(menu).toHaveAttribute('aria-orientation', 'horizontal');
    const geometry = () => page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-workbench-menu] [role="tab"]')].map(node => node.getBoundingClientRect());
      const workspace = document.querySelector('.workbench__workspace')!.getBoundingClientRect();
      return { rows: new Set(items.map(item => Math.round(item.top))).size, above: items.at(-1)!.bottom <= workspace.top };
    });
    await expect.poll(async () => (await geometry()).rows).toBeGreaterThan(1);
    expect((await geometry()).above).toBe(true);
    await noOverflow(page);
    await drop(page, 'zip/sample.zip');
    await expect.poll(async () => (await geometry()).rows).toBeGreaterThan(1);
    expect((await geometry()).above).toBe(true);
    await noOverflow(page);
    await tab(page, locale, AVAILABLE_OPS[0]).focus();
    await page.keyboard.press('ArrowLeft'); await selected(page, locale, 'fix-names');
    await page.keyboard.press('ArrowRight'); await selected(page, locale, 'browse');
    await page.evaluate(() => {
      (window as Window & { __menuKeys?: boolean[] }).__menuKeys = [];
      document.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
          (window as Window & { __menuKeys?: boolean[] }).__menuKeys?.push(event.defaultPrevented);
      });
    });
    const before = await page.evaluate(() => scrollY);
    await page.keyboard.press('ArrowDown');
    await selected(page, locale, 'browse');
    await expect(tab(page, locale, AVAILABLE_OPS[0])).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(before);
    await page.keyboard.press('ArrowUp'); await selected(page, locale, 'browse');
    expect(await page.evaluate(() => (window as Window & { __menuKeys?: boolean[] }).__menuKeys)).toEqual([false, false]);
  });

  test(`${locale} header, menu and workspace follow the Tab order`, async ({ page, browserName }) => {
    // WebKit leaves links out of the Tab order by default, so only the form controls are asserted there.
    const linksTabbable = browserName !== 'webkit';
    await page.goto(zipHome(locale)); await ready(page);
    const header = page.locator('[data-chrome-locale]').last();
    await header.focus();
    await page.keyboard.press('Tab');
    const first = tab(page, locale, AVAILABLE_OPS[0]);
    await expect(first).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: copy[locale].shared.language })).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(first).toBeFocused();
    if (linksTabbable) {
      await page.keyboard.press('Shift+Tab'); await expect(header).toBeFocused();
      await page.keyboard.press('Tab'); await expect(first).toBeFocused();
    }
    await page.keyboard.press('ArrowRight');
    const next = tab(page, locale, AVAILABLE_OPS[1]);
    await expect(next).toBeFocused();
    await selected(page, locale, 'extract');
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: copy[locale].shared.language })).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(next).toBeFocused();
    if (linksTabbable) { await page.keyboard.press('Shift+Tab'); await expect(header).toBeFocused(); }
  });
}
