import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ui as enUi } from '../../src/i18n/en/ui';
import { ui as jaUi } from '../../src/i18n/ja/ui';
import { drop, ready, select } from './_helpers';
import { zipOp } from './_paths';

const copy = { en: enUi, ja: jaUi };
const fixture = () => readFile(join(process.cwd(), 'tests/fixtures/archive/sample.tar.gz'));
const expected = [
  ['docs/notes.txt', 'a nested note\n'], ['readme.txt', 'hello from extract-rar-7z\n'],
] as const;

for (const locale of ['en', 'ja'] as const) for (const entry of ['browse', 'extract'] as const) {
  test(`${locale} ${entry} lists gzip and saves individual and all files`, async ({ page }) => {
    const t = copy[locale].workbench;
    let downloads = 0;
    let saves = 0;
    page.on('download', () => { downloads++; });
    await page.goto(zipOp(locale, entry)); await ready(page);
    const bytes = await fixture();
    for (const name of ['sample.tar.gz', 'x.bin']) {
      if (name === 'sample.tar.gz') await drop(page, 'archive/sample.tar.gz');
      else {
        await page.locator('.workbench__picker input').setInputFiles({ name, mimeType: 'text/plain', buffer: bytes });
        await expect(page.locator('.workbench__filename')).toHaveText(name);
        await expect(page.locator('.workbench__picker input')).toBeEnabled();
        await expect(page.getByRole('alert')).toHaveCount(0);
      }
      await expect(page.locator('.workbench__kind')).toHaveText('(gzip)');
      await expect(page.getByRole('tab')).toHaveCount(2);
      for (const op of ['browse', 'extract'] as const)
        await expect(page.getByRole('tab', { name: copy[locale].menu[op].verb, exact: true })).toBeVisible();
      await select(page, 'browse');
      await expect(page.locator('#panel-browse [role="listitem"]')).toHaveCount(2);
      await expect(page.locator('#panel-browse .workbench__name')).toHaveText(expected.map(([path]) => path));
      expect(downloads).toBe(saves);
      for (const mode of ['one', 'all'] as const) {
        await select(page, 'extract');
        await page.getByRole('radio', { name: mode === 'one' ? t.one : `${t.all} (2)`, exact: true }).check();
        if (mode === 'one') await page.getByRole('combobox', { name: t.one, exact: true }).selectOption('readme.txt');
        const cards = page.locator('article.workbench__result');
        const count = await cards.count();
        expect(downloads).toBe(saves);
        await page.getByRole('button', { name: `${t.run}: ${mode === 'one' ? 'readme.txt' : name}`, exact: true }).click();
        await expect(cards).toHaveCount(count + 1);
        const card = cards.nth(count);
        const files = mode === 'one' ? [expected[1]] : expected;
        await expect(card.locator('.workbench__result-source')).toHaveText(`${t.source}: ${name}`);
        await expect(card.locator('.workbench__name')).toHaveText(files.map(([path]) => path));
        expect(downloads).toBe(saves);
        for (const [path, content] of files) {
          const download = page.waitForEvent('download');
          await card.getByRole('button', { name: `${t.saveFile}: ${path}`, exact: true }).click();
          const saved = await download;
          expect(saved.suggestedFilename()).toBe(path.split('/').at(-1));
          expect((await readFile((await saved.path())!)).toString('utf8')).toBe(content);
          saves++;
          expect(downloads).toBe(saves);
        }
      }
    }
    expect(await fixture()).toEqual(bytes);
  });

  test(`${locale} ${entry} rejects unreadable gzip and accepts the next archive`, async ({ page }) => {
    const t = copy[locale].workbench;
    let downloads = 0;
    page.on('download', () => { downloads++; });
    const bytes = await fixture();
    for (const [name, buffer] of [
      ['text.gz', gzipSync(Buffer.from('ordinary text\n'))],
      ['truncated.tar.gz', bytes.subarray(0, 12)],
    ] as const) {
      await page.goto(zipOp(locale, entry)); await ready(page);
      await page.locator('.workbench__picker input').setInputFiles({ name, mimeType: 'application/gzip', buffer });
      await expect(page.locator('.workbench__filename')).toHaveText(name);
      await expect(page.getByRole('alert')).toContainText(t.unsupported);
      await expect(page.locator('.workbench__picker input')).toBeEnabled();
      await expect(page.locator('.workbench__kind')).toHaveText('(gzip)');
      await expect(page.locator('#panel-browse [role="listitem"]')).toHaveCount(0);
      await expect(page.locator('article.workbench__result')).toHaveCount(0);
      expect(downloads).toBe(0);
      await drop(page, 'archive/sample.tar.gz');
      await select(page, 'browse');
      await expect(page.locator('#panel-browse [role="listitem"]')).toHaveCount(2);
      await expect(page.locator('article.workbench__result')).toHaveCount(0);
      expect(downloads).toBe(0);
    }
  });
}
