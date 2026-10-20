import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ui as enUi } from '../../src/i18n/en/ui';
import { ui as jaUi } from '../../src/i18n/ja/ui';
import { ready, select } from './_helpers';
import { chooseFiles, dropFiles, saveCreated, zipContents } from './_create-input';
import { zipHome, zipOp } from './_paths';

const dictionaries = { en: enUi, ja: jaUi };
for (const locale of ['ja', 'en'] as const) {
  test(`${locale} creation is reachable by direct URL, navigation, card, menu and history`, async ({ page }) => {
    const copy = dictionaries[locale];
    await page.goto(zipOp(locale, 'create')); await ready(page);
    await expect(page.locator('#tab-create')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-create')).toBeVisible();
    await expect(page.locator('#panel-create input[type="file"]')).toHaveCount(2);
    await page.locator('[data-chrome-page="browse"]').click();
    await page.locator('[data-chrome-page="create"]').click();
    await expect(page).toHaveURL(new RegExp(`${zipOp(locale, 'create')}$`));
    await page.goBack(); await expect(page.locator('#tab-browse')).toHaveAttribute('aria-selected', 'true');
    await page.goForward(); await expect(page.locator('#tab-create')).toHaveAttribute('aria-selected', 'true');
    await page.goto(zipHome(locale)); await ready(page);
    await page.locator(`[data-operation-cards][data-lang="${locale}"]`).getByRole('link', { name: copy.menu.create.verb }).click();
    await ready(page);
    await expect(page).toHaveURL(new RegExp(`${zipOp(locale, 'create')}$`));
    await select(page, 'browse');
    await select(page, 'create');
    await page.locator('#tab-create').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-browse')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#tab-create')).toBeFocused();
    const next = locale === 'en' ? 'ja' : 'en';
    await page.getByLabel(copy.shared.language).selectOption(next);
    await expect(page).toHaveURL(new RegExp(`${zipOp(next, 'create')}$`));
    await expect(page.locator('#panel-create')).toContainText(dictionaries[next].create.emptyGuide);
    await expect(page.locator('[data-chrome-page="create"]')).toHaveText(dictionaries[next].menu.create.verb);
    await page.goBack();
    await expect(page.locator('#panel-create')).toContainText(copy.create.emptyGuide);
  });

  test(`${locale} selects multiple files, creates and explicitly saves their names and contents`, async ({ page }) => {
    const copy = dictionaries[locale].create;
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await page.goto(zipOp(locale, 'create')); await ready(page);
    await chooseFiles(page, [{ name: 'note.txt', text: 'first' }, { name: 'メモ.txt', text: '日本語' }]);
    await expect(page.locator('#panel-create [role="listitem"]')).toHaveCount(2);
    await page.locator('#panel-create').getByRole('button', { name: copy.run, exact: true }).click();
    await expect(page.locator('#panel-create')).toContainText(`${copy.resultSummary}: 2`);
    expect(downloads).toBe(0);
    const contents = await zipContents(await saveCreated(page, copy.save));
    expect(Object.keys(contents)).toEqual(['note.txt', 'メモ.txt']);
    expect(Buffer.from(contents['note.txt']).toString()).toBe('first');
    expect(Buffer.from(contents['メモ.txt']).toString()).toBe('日本語');
    expect(downloads).toBe(1);
    await page.getByRole('button', { name: new RegExp(`^${dictionaries[locale].workbench.reset}:`) }).click();
    await expect(page.locator('#panel-create [role="listitem"]')).toHaveCount(0);
    await expect(page.locator('#panel-create')).not.toContainText('created.zip');
    await expect(page.locator('#panel-create').getByRole('button', { name: copy.run, exact: true })).toBeDisabled();
  });
}

test('DOM drops retain colliding files and exclude the same selection added again', async ({ page }) => {
  await page.goto(zipOp('en', 'create')); await ready(page);
  const files = [
    { name: 'same.txt', text: 'first', lastModified: 1 },
    { name: 'same.txt', text: 'second', lastModified: 2 },
    { name: 'same.txt', text: 'third', lastModified: 3 },
  ];
  await dropFiles(page, files);
  await expect(page.locator('#panel-create [role="listitem"]')).toHaveCount(3);
  await dropFiles(page, files);
  await expect(page.locator('#panel-create [role="listitem"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Create new ZIP', exact: true }).click();
  await expect(page.locator('#panel-create')).toContainText('Creation result: 3');
  const contents = await zipContents(await saveCreated(page));
  expect(Object.keys(contents)).toEqual(['same.txt', 'same (1).txt', 'same (2).txt']);
  expect(Object.values(contents).map(bytes => Buffer.from(bytes).toString())).toEqual(['first', 'second', 'third']);
});

test('folder input preserves nested relative paths and contents', async ({ page, browserName }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'create-folder-'));
  const folder = join(root, 'folder');
  try {
    await mkdir(join(folder, 'nested'), { recursive: true });
    await writeFile(join(folder, 'note.txt'), 'top');
    await writeFile(join(folder, 'nested', 'note.txt'), 'nested');
    await page.goto(zipOp('en', 'create')); await ready(page);
    try {
      await page.locator('#panel-create input[webkitdirectory]').setInputFiles(folder);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only an explicit automation capability rejection is eligible for a browser-specific skip.
      if (!/not supported|does not support/i.test(message)) throw error;
      testInfo.annotations.push({ type: 'folder-input', description: `${browserName}: directory input automation is unsupported` });
      test.skip(true, `${browserName}: setInputFiles rejected directory input as unsupported`);
    }
    await expect(page.locator('#panel-create [role="listitem"]')).toHaveCount(2);
    await expect(page.locator('#panel-create')).toContainText('folder/nested/note.txt');
    await page.getByRole('button', { name: 'Create new ZIP', exact: true }).click();
    await expect(page.locator('#panel-create')).toContainText('Creation result: 2');
    const contents = await zipContents(await saveCreated(page));
    expect(Object.keys(contents).sort()).toEqual(['folder/nested/note.txt', 'folder/note.txt']);
    expect(Buffer.from(contents['folder/note.txt']).toString()).toBe('top');
    expect(Buffer.from(contents['folder/nested/note.txt']).toString()).toBe('nested');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('simulated total sizes enforce the boundary without processing large data', async ({ page }) => {
  await page.goto(zipOp('en', 'create')); await ready(page);
  const run = page.getByRole('button', { name: 'Create new ZIP', exact: true });
  await expect(run).toBeDisabled();
  for (const total of [999_999_999, 1_000_000_000, 1_000_000_001]) {
    await dropFiles(page, [{ name: 'first.txt', text: 'small', size: 500_000_000 },
      { name: 'second.txt', text: 'small', size: total - 500_000_000 }]);
    await expect(page.locator('#panel-create [role="listitem"]')).toHaveCount(2);
    if (total > 1_000_000_000) {
      await expect(run).toBeDisabled();
      await expect(page.locator('#panel-create [role="alert"]')).toHaveText(enUi.create.tooLarge);
    } else {
      await expect(run).toBeEnabled();
      await expect(page.locator('#panel-create [role="alert"]')).toHaveCount(0);
    }
    await expect(page.locator('#panel-create')).not.toContainText('created.zip');
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  }
});

test('an announced waiting update remains deferred after creation and saving until Reset', async ({ page }) => {
  // Announce a waiting worker while retaining the real registration and browser coordination APIs.
  // Activation between different builds remains a separate device check.
  await page.addInitScript(() => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = async (...args) => {
      const registration = await register(...args);
      Object.defineProperty(registration, 'active', { value: { state: 'activated' } });
      Object.defineProperty(registration, 'waiting', { value: { postMessage() {} } });
      return registration;
    };
  });
  await page.goto(zipOp('en', 'create')); await ready(page);
  const update = page.getByRole('button', { name: 'Update', exact: true });
  await expect(update).toBeEnabled();
  await chooseFiles(page, [{ name: 'note.txt', text: 'retained' }]);
  await expect(update).toBeDisabled();
  await expect(page.locator('.update-prompt')).toContainText('Reloading loses the input');
  await page.getByRole('button', { name: 'Create new ZIP', exact: true }).click();
  await expect(page.locator('#panel-create')).toContainText('Creation result: 1');
  await expect(update).toBeDisabled();
  await saveCreated(page);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.locator('#panel-create [role="listitem"]')).toHaveCount(0);
  await expect(update).toBeDisabled();
  await expect(page.locator('#panel-create')).toContainText('created.zip');
  await page.getByRole('button', { name: /^Reset:/ }).click();
  await expect(page.locator('#panel-create')).not.toContainText('created.zip');
  await expect(update).toBeEnabled();
});
