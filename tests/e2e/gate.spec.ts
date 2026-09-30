import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configure, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { expect, test, type Page } from '@playwright/test';
import { ready, select, save, reinput, roundTrip } from './_helpers';
import { visit } from './_covenant-support';
import { zipHome } from './_paths';

configure({ useWebWorkers: false });
const fixture = (path: string) => readFile(join(process.cwd(), 'tests/fixtures', path));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cards = (page: Page) => page.locator('article.workbench__result');
const list = (page: Page, op: 'browse' | 'remove') => page.locator('#panel-' + op + ' [role="list"]');

async function zip(items: { name: string; text: string; encrypted?: boolean }[]) {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useUnicodeFileNames: true });
  for (const item of items) await writer.add(item.name, new TextReader(item.text),
    item.encrypted ? { password: 'fictional-gate-password', encryptionStrength: 3 } : {});
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}
async function intake(page: Page, bytes: Uint8Array, name: string) {
  await ready(page);
  const before = digest(bytes);
  const held = await page.evaluate(async ({ data, name }) => {
    const file = new File([new Uint8Array(data)], name);
    (window as Window & { __gateFile?: File }).__gateFile = file;
    const hash = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const initial = await hash();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => { window.removeEventListener('filesProcessed', done); reject(new Error('Input timed out')); }, 30_000);
      const done = () => { clearTimeout(timeout); window.removeEventListener('filesProcessed', done); resolve(); };
      window.addEventListener('filesProcessed', done, { once: true });
      window.dispatchEvent(new CustomEvent('filesDropped', { detail: [file] }));
    });
    return initial;
  }, { data: Array.from(bytes), name });
  expect(held).toBe(before);
  return before;
}
async function unchanged(page: Page, path: string, before: string) {
  expect(digest(await fixture(path))).toBe(before);
  await heldUnchanged(page, before);
}
async function heldUnchanged(page: Page, before: string) {
  const held = await page.evaluate(async () => {
    const file = (window as Window & { __gateFile?: File }).__gateFile;
    if (!file) throw new Error('Input file was not retained');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
      .map(value => value.toString(16).padStart(2, '0')).join('');
  });
  expect(held).toBe(before);
}
function watchDownloads(page: Page) {
  let count = 0;
  page.on('download', () => { count++; });
  return () => count;
}
async function noOutput(page: Page, downloads: () => number) {
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save file:/ })).toHaveCount(0);
  expect(downloads()).toBe(0);
}
async function produced(page: Page, button: string, name: string) {
  await page.getByRole('button', { name: button }).click();
  await expect(cards(page)).toHaveCount(1);
  const card = cards(page).first();
  await expect(card.getByRole('button', { name: 'Save file: ' + name })).toBeVisible();
  return card;
}
async function extractOne(page: Page, name: string, content: string) {
  await select(page, 'extract');
  await page.getByRole('radio', { name: 'One' }).check();
  await page.getByRole('combobox', { name: 'One' }).selectOption(name);
  const card = await produced(page, 'Extract: ' + name, name);
  expect((await save(page, card, name)).toString('utf8')).toBe(content);
}
async function paging(page: Page, op: 'browse' | 'remove', total: number) {
  const root = page.locator('#panel-' + op);
  const rows = list(page, op);
  const label = op === 'browse' ? 'Browse' : 'Remove';
  const previous = root.getByRole('button', { name: 'Previous: ' + label + ' Page' });
  const next = root.getByRole('button', { name: 'Next: ' + label + ' Page' });
  await expect(rows.getByRole('listitem')).toHaveCount(500);
  await expect(rows.getByText('file-000.txt', { exact: true })).toBeVisible();
  await expect(rows.getByText('file-499.txt', { exact: true })).toBeVisible();
  await expect(previous).toBeDisabled();
  if (total === 500) {
    await expect(root.getByText('Page 1 / 1')).toBeVisible();
    await expect(next).toBeDisabled();
  } else {
    await expect(root.getByText('Page 1 / 2')).toBeVisible();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(rows.getByRole('listitem')).toHaveCount(1);
    await expect(rows.getByText('file-500.txt', { exact: true })).toBeVisible();
    await expect(root.getByText('Page 2 / 2')).toBeVisible();
    await expect(previous).toBeEnabled();
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(rows.getByRole('listitem')).toHaveCount(500);
    await expect(rows.getByText('file-000.txt', { exact: true })).toBeVisible();
  }
}

test('Japanese extraction and repair preserve the source', async ({ page }) => {
  await visit(page, zipHome('en'));
  const samplePath = 'zip/sample.zip';
  const sample = await fixture(samplePath);
  const sampleHash = await intake(page, sample, 'sample.zip');
  await expect(list(page, 'browse').getByText('メモ.txt', { exact: true })).toBeVisible();
  await extractOne(page, 'メモ.txt', '日本語\n');
  await unchanged(page, samplePath, sampleHash);
  const path = 'zip/rewrite/mojibake.zip';
  const original = await fixture(path);
  const hash = await intake(page, original, 'mojibake.zip');
  await select(page, 'fix-names');
  await expect(page.locator('#panel-fix-names [role="listitem"]')).toContainText('Candidate: メモ帳.txt');
  await page.getByRole('button', { name: 'Repair names into a new ZIP: mojibake.zip' }).click();
  await expect(cards(page)).toHaveCount(2);
  const card = cards(page).last();
  const output = await save(page, card, 'mojibake-fixed.zip');
  expect(digest(output)).not.toBe(hash);
  await unchanged(page, path, hash);
  await reinput(page, card, 'mojibake-fixed.zip');
  await select(page, 'browse');
  await expect(list(page, 'browse').getByText('メモ帳.txt', { exact: true })).toBeVisible();
  await select(page, 'extract');
  await page.getByRole('radio', { name: 'One' }).check();
  await page.getByRole('combobox', { name: 'One' }).selectOption('メモ帳.txt');
  await page.getByRole('button', { name: 'Extract: メモ帳.txt' }).click();
  await expect(cards(page)).toHaveCount(3);
  expect((await save(page, cards(page).last(), 'メモ帳.txt')).toString()).toBe('これは日本語のメモです。');
});

test('empty ZIP has one inert page and zero-file extraction', async ({ page }) => {
  await visit(page, zipHome('en'));
  const bytes = new Uint8Array(22);
  bytes.set([0x50, 0x4b, 0x05, 0x06]);
  await intake(page, bytes, 'empty.zip');
  await expect(page.locator('#panel-browse')).toContainText('Total entries: 0 / Files: 0 / Extractable files: 0');
  await expect(list(page, 'browse').getByRole('listitem')).toHaveCount(0);
  await expect(page.locator('#panel-browse').getByText('Page 1 / 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous: Browse Page' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next: Browse Page' })).toBeDisabled();
  await select(page, 'extract');
  await page.getByRole('button', { name: 'Extract: empty.zip' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('0 files');
  await expect(cards(page).first().getByRole('button', { name: /^Save file:/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

const mixed = () => zip([
  { name: 'open.txt', text: 'open' },
  { name: 'locked.txt', text: 'secret', encrypted: true },
  { name: 'drop.txt', text: 'drop' },
]);
test('encrypted entries are listed but excluded from extraction', async ({ page }) => {
  await visit(page, zipHome('en'));
  await intake(page, await mixed(), 'mixed.zip');
  await expect(page.locator('#panel-browse')).toContainText('Total entries: 3 / Files: 3 / Extractable files: 2');
  await expect(list(page, 'browse').getByText('locked.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select for extraction: locked.txt' })).toHaveCount(0);
  await select(page, 'extract');
  await expect(page.locator('#panel-extract')).toContainText('Encrypted files and directories are excluded from Extract all.');
  await page.getByRole('radio', { name: 'One' }).check();
  await expect(page.getByRole('combobox', { name: 'One' }).locator('option')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'One' }).locator('option[value="locked.txt"]')).toHaveCount(0);
  await page.getByRole('radio', { name: 'All' }).check();
  await page.getByRole('button', { name: 'Extract: mixed.zip' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('2 files');
  for (const name of ['open.txt', 'drop.txt']) await expect(cards(page).first().getByRole('button', { name: 'Save file: ' + name })).toBeVisible();
  await expect(cards(page).first().getByRole('button', { name: 'Save file: locked.txt' })).toHaveCount(0);
});
test('keeping an encrypted entry makes removal fail without output', async ({ page }) => {
  await visit(page, zipHome('en'));
  const bytes = await mixed();
  const hash = await intake(page, bytes, 'mixed.zip');
  const downloads = watchDownloads(page);
  await select(page, 'remove');
  await page.getByRole('checkbox', { name: 'drop.txt: Keep' }).uncheck();
  await expect(page.locator('#panel-remove')).toContainText('Rewriting fails if encrypted entries remain.');
  await page.getByRole('button', { name: 'Create new ZIP: mixed.zip' }).click();
  await expect(page.getByRole('alert')).toContainText('This operation cannot process encrypted entries.');
  await noOutput(page, downloads);
  expect(digest(bytes)).toBe(hash);
  await heldUnchanged(page, hash);
});
test('excluding an encrypted entry produces a plain ZIP', async ({ page }) => {
  await visit(page, zipHome('en'));
  const bytes = await mixed();
  const hash = await intake(page, bytes, 'mixed.zip');
  await select(page, 'remove');
  await page.getByRole('checkbox', { name: 'locked.txt: Keep' }).uncheck();
  const card = await produced(page, 'Create new ZIP: mixed.zip', 'mixed-trimmed.zip');
  expect(digest(await save(page, card, 'mixed-trimmed.zip'))).not.toBe(hash);
  await heldUnchanged(page, hash);
  await reinput(page, card, 'mixed-trimmed.zip');
  await select(page, 'browse');
  await expect(page.locator('#panel-browse')).toContainText('Total entries: 2 / Files: 2 / Extractable files: 2');
  await expect(list(page, 'browse').getByText('locked.txt', { exact: true })).toHaveCount(0);
  await expect(list(page, 'browse').getByText('open.txt', { exact: true })).toBeVisible();
  await expect(list(page, 'browse').getByText('drop.txt', { exact: true })).toBeVisible();
  await select(page, 'extract');
  await page.getByRole('radio', { name: 'One' }).check();
  for (const name of ['open.txt', 'drop.txt']) {
    await page.getByRole('combobox', { name: 'One' }).selectOption(name);
    await page.getByRole('button', { name: 'Extract: ' + name }).click();
    await expect(cards(page)).toHaveCount(name === 'open.txt' ? 2 : 3);
    expect((await save(page, cards(page).last(), name)).toString()).toBe(name === 'open.txt' ? 'open' : 'drop');
  }
});
test('unreadable ZIP reports listing error and preserves input', async ({ page }) => {
  await visit(page, zipHome('en'));
  const path = 'zip/recover/bad-central.zip';
  const downloads = watchDownloads(page);
  const hash = await intake(page, await fixture(path), 'bad-central.zip');
  await expect(page.getByRole('alert')).toContainText('Could not read the ZIP directory information.');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await noOutput(page, downloads);
  await unchanged(page, path, hash);
});
for (const mode of ['one', 'all'] as const) test('CRC-damaged ZIP ' + mode + ' extraction reports error without output', async ({ page }) => {
  await visit(page, zipHome('en'));
  const path = 'zip/recover/crc-broken.zip';
  const downloads = watchDownloads(page);
  const hash = await intake(page, await fixture(path), 'crc-broken.zip');
  await expect(list(page, 'browse').getByText('broken.txt', { exact: true })).toBeVisible();
  await select(page, 'extract');
  if (mode === 'one') {
    await page.getByRole('radio', { name: 'One' }).check();
    await page.getByRole('combobox', { name: 'One' }).selectOption('broken.txt');
  }
  await page.getByRole('button', { name: mode === 'one' ? 'Extract: broken.txt' : 'Extract: crc-broken.zip' }).click();
  await expect(page.getByRole('alert')).toContainText('A file in the ZIP is corrupted and could not be extracted.');
  await noOutput(page, downloads);
  await unchanged(page, path, hash);
});
test('removal rejects kept CRC damage and succeeds when excluded', async ({ page }) => {
  await visit(page, zipHome('en'));
  const path = 'zip/recover/crc-broken.zip';
  const bytes = await fixture(path);
  const downloads = watchDownloads(page);
  const hash = await intake(page, bytes, 'crc-broken.zip');
  await select(page, 'remove');
  await page.getByRole('checkbox', { name: 'also-ok.csv: Keep' }).uncheck();
  await page.getByRole('button', { name: 'Create new ZIP: crc-broken.zip' }).click();
  await expect(page.getByRole('alert')).toContainText('A file in the ZIP is corrupted and could not be extracted.');
  await noOutput(page, downloads);
  await unchanged(page, path, hash);
  await visit(page, zipHome('en'));
  await intake(page, bytes, 'crc-broken.zip');
  await select(page, 'remove');
  await page.getByRole('checkbox', { name: 'broken.txt: Keep' }).uncheck();
  const card = await produced(page, 'Create new ZIP: crc-broken.zip', 'crc-broken-trimmed.zip');
  expect(digest(await save(page, card, 'crc-broken-trimmed.zip'))).not.toBe(hash);
  await unchanged(page, path, hash);
  await reinput(page, card, 'crc-broken-trimmed.zip');
  await select(page, 'browse');
  await expect(list(page, 'browse').getByText('broken.txt', { exact: true })).toHaveCount(0);
  await expect(list(page, 'browse').getByText('intact.txt', { exact: true })).toBeVisible();
  await expect(list(page, 'browse').getByText('also-ok.csv', { exact: true })).toBeVisible();
  await select(page, 'extract');
  await page.getByRole('radio', { name: 'One' }).check();
  for (const [name, expected] of [
    ['intact.txt', 'this file is perfectly fine and readable\n'],
    ['also-ok.csv', 'name,city\nAda,London\nGrace,New York\n'],
  ] as const) {
    await page.getByRole('combobox', { name: 'One' }).selectOption(name);
    await page.getByRole('button', { name: 'Extract: ' + name }).click();
    await expect(cards(page)).toHaveCount(name === 'intact.txt' ? 2 : 3);
    expect((await save(page, cards(page).last(), name)).toString()).toBe(expected);
  }
});
test('name repair rejects a damaged payload without output', async ({ page }) => {
  await visit(page, zipHome('en'));
  const bytes = Uint8Array.from(await fixture('zip/rewrite/mojibake.zip'));
  const central = bytes.findIndex((_, index) => bytes[index] === 0x50 && bytes[index + 1] === 0x4b &&
    bytes[index + 2] === 0x01 && bytes[index + 3] === 0x02);
  expect(central).toBeGreaterThanOrEqual(0);
  bytes[central + 16] ^= 0x01;
  bytes[14] ^= 0x01;
  const downloads = watchDownloads(page);
  const hash = await intake(page, bytes, 'damaged-name.zip');
  await select(page, 'fix-names');
  await expect(page.locator('#panel-fix-names [role="listitem"]')).toContainText('Candidate: メモ帳.txt');
  await page.getByRole('button', { name: 'Repair names into a new ZIP: damaged-name.zip' }).click();
  await expect(page.getByRole('alert')).toContainText('A file in the ZIP is corrupted and could not be extracted.');
  await noOutput(page, downloads);
  expect(digest(bytes)).toBe(hash);
  await heldUnchanged(page, hash);
});
for (const count of [500, 501]) test(String(count) + ' entries page correctly in browse and removal', async ({ page }) => {
  await visit(page, zipHome('en'));
  const bytes = await zip(Array.from({ length: count }, (_, index) => ({
    name: 'file-' + String(index).padStart(3, '0') + '.txt', text: String(index),
  })));
  await intake(page, bytes, 'many.zip');
  await paging(page, 'browse', count);
  await select(page, 'remove');
  await paging(page, 'remove', count);
});
for (const name of ['unknown.bin', 'unknown.zip']) test('unrecognized bytes in ' + name + ' show no operation or output', async ({ page }) => {
  await visit(page, zipHome('en'));
  const downloads = watchDownloads(page);
  const hash = await intake(page, new Uint8Array([0x13, 0x37, 0x00, 0x42, 0x19]), name);
  await expect(page.getByRole('alert')).toContainText('Format could not be identified.');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await noOutput(page, downloads);
  await heldUnchanged(page, hash);
});
test('existing public operation round trip remains available', async ({ page }) => {
  await visit(page, zipHome('en'));
  await roundTrip(page);
});

// Offline revisit and old service-worker migration are covered by covenants.spec.ts and sw-migration.spec.ts.
