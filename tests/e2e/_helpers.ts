import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AVAILABLE_OPS, type AvailableOpId } from '../../src/i18n/ops';
import { publicPageFromPath } from '../../src/seo/page';

const fixture = (path: string) => join(process.cwd(), 'tests/fixtures', path);
export async function ready(page: Page) {
  await page.waitForFunction(() => window.__toolReady === true, undefined, { timeout: 30_000 });
}
const observedPages = new WeakSet<Page>();
export async function observePwaStartup(page: Page) {
  if (observedPages.has(page)) return;
  await page.addInitScript(() => {
    const calls: { script: string; scope: string | undefined }[] = [];
    Object.assign(window, { __pwaRegisterCalls: calls });
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const register = worker.register;
    worker.register = function (...args) {
      calls.push({ script: String(args[0]), scope: args[1]?.scope });
      return Reflect.apply(register, this, args);
    };
  });
  observedPages.add(page);
}
export async function publicReady(page: Page) {
  const path = new URL(page.url()).pathname;
  const route = publicPageFromPath(path);
  if (!route || new URL(page.url()).search || new URL(page.url()).hash) throw new Error(`Unknown public page: ${page.url()}`);
  await page.waitForLoadState('load');
  await expect(page.locator('#page-heading')).toBeVisible();
  await expect(page.locator('#page-content')).toBeVisible();
  if (route.page !== 'hub') return ready(page);
  await page.waitForFunction(() => {
    const calls = (window as typeof window & { __pwaRegisterCalls?: { script: string; scope?: string }[] }).__pwaRegisterCalls;
    return calls?.some(call => new URL(call.script, location.href).pathname === '/sw.js' && call.scope === '/');
  }, undefined, { timeout: 30_000 });
}
export async function drop(page: Page, path: string) {
  const bytes = await readFile(fixture(path));
  const name = path.split('/').at(-1)!;
  await ready(page);
  await page.evaluate(async ({ data, name }) => {
    const file = new File([new Uint8Array(data)], name);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => { window.removeEventListener('filesProcessed', done); reject(new Error('File intake timed out')); }, 30_000);
      const done = () => { clearTimeout(timeout); window.removeEventListener('filesProcessed', done); resolve(); };
      window.addEventListener('filesProcessed', done, { once: true });
      window.dispatchEvent(new CustomEvent('filesDropped', { detail: [file] }));
    });
  }, { data: [...bytes], name });
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Browse' })).toBeEnabled();
}
export async function select(page: Page, op: AvailableOpId) {
  await page.locator(`[data-op="${op}"]`).click();
  await expect(page.locator(`[data-op="${op}"]`)).toHaveAttribute('aria-selected', 'true');
}
const resultCards = (page: Page) => page.locator('article.workbench__result');

async function createdResult(page: Page, archive: string, name: string, run: () => Promise<void>) {
  const cards = resultCards(page);
  const previousCount = await cards.count();
  await run();
  await expect(cards).toHaveCount(previousCount + 1);
  const card = cards.nth(previousCount);
  await expect(card.getByText(`Source file: ${archive}`, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: `Save file: ${name}` })).toBeVisible();
  return card;
}

export async function save(page: Page, card: Locator, name: string) {
  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: `Save file: ${name}` }).click();
  const item = await download;
  const path = await item.path();
  if (!path) throw new Error(`No download path for ${name}`);
  return readFile(path);
}
export async function reinput(page: Page, card: Locator, name: string) {
  await card.getByRole('button', { name: `Use as next input: ${name}` }).click();
  await expect(page.getByRole('tab', { name: 'Browse' })).toBeVisible();
}
async function browse(page: Page, names: string[]) {
  await select(page, 'browse');
  const list = page.locator('#panel-browse [role="list"]');
  for (const name of names) await expect(list.getByText(name, { exact: true })).toBeVisible();
}
async function extract(page: Page, archive: string, name: string, content: string) {
  await select(page, 'extract');
  await page.getByRole('radio', { name: 'One' }).check();
  await page.getByRole('combobox', { name: 'One' }).selectOption(name);
  const card = await createdResult(page, archive, name, () =>
    page.getByRole('button', { name: `Extract: ${name}` }).click());
  expectText(await save(page, card, name), content, `${archive}/${name}`);
}
function expectText(bytes: Buffer, content: string, subject: string) {
  expect(bytes.toString('utf8'), subject).toBe(content);
}

const drivers: Record<AvailableOpId, (page: Page) => Promise<void>> = {
  browse: async page => browse(page, ['readme.txt', 'docs/notes.txt', 'docs/sub/deep.txt', 'メモ.txt', 'images/']),
  extract: async page => extract(page, 'sample.zip', 'readme.txt', 'hello from unzip\n'),
  remove: async page => {
    await select(page, 'remove');
    await page.getByRole('checkbox', { name: 'docs/notes.txt: Keep' }).uncheck();
    const card = await createdResult(page, 'sample.zip', 'sample-trimmed.zip', () =>
      page.getByRole('button', { name: 'Create new ZIP: sample.zip' }).click());
    await save(page, card, 'sample-trimmed.zip');
    await reinput(page, card, 'sample-trimmed.zip');
    const list = page.locator('#panel-browse [role="list"]');
    await expect(list.getByText('docs/notes.txt', { exact: true })).toHaveCount(0);
    await browse(page, ['readme.txt', 'docs/sub/deep.txt', 'メモ.txt', 'images/']);
    await extract(page, 'sample-trimmed.zip', 'readme.txt', 'hello from unzip\n');
  },
  'fix-names': async page => {
    await drop(page, 'zip/rewrite/mojibake.zip');
    await select(page, 'fix-names');
    await expect(page.locator('#panel-fix-names [role="listitem"]')).toContainText('Candidate:');
    const card = await createdResult(page, 'mojibake.zip', 'mojibake-fixed.zip', () =>
      page.getByRole('button', { name: 'Repair names into a new ZIP: mojibake.zip' }).click());
    await save(page, card, 'mojibake-fixed.zip');
    await reinput(page, card, 'mojibake-fixed.zip');
    await browse(page, ['メモ帳.txt']);
    await extract(page, 'mojibake-fixed.zip', 'メモ帳.txt', 'これは日本語のメモです。');
  },
};

export async function roundTrip(page: Page, checkpoint: () => void = () => {}) {
  const available = AVAILABLE_OPS.map(op => op.id);
  expect(Object.keys(drivers).sort()).toEqual([...available].sort());
  await drop(page, 'zip/sample.zip');
  await browse(page, ['readme.txt', 'docs/notes.txt', 'docs/sub/deep.txt', 'メモ.txt', 'images/']);
  checkpoint();
  for (const op of available) {
    if (op === 'fix-names') continue;
    await drivers[op](page);
    checkpoint();
    if (op === 'remove') await drop(page, 'zip/sample.zip');
  }
  await drivers['fix-names'](page);
  checkpoint();
  await drop(page, 'archive/sample.7z');
  const archiveOps = AVAILABLE_OPS.filter(op => op.archive).map(op => op.id);
  expect(archiveOps.sort()).toEqual(['browse', 'extract']);
  await expect(page.getByRole('tab')).toHaveCount(archiveOps.length);
  await browse(page, ['readme.txt', 'docs/notes.txt']);
  await extract(page, 'sample.7z', 'readme.txt', 'hello from extract-rar-7z\n');
  checkpoint();
  await extract(page, 'sample.7z', 'docs/notes.txt', 'a nested note\n');
  checkpoint();
  await drop(page, 'zip/nested.zip');
  await browse(page, ['inner.zip']);
  await select(page, 'extract');
  await page.getByRole('radio', { name: 'One' }).check();
  await page.getByRole('combobox', { name: 'One' }).selectOption('inner.zip');
  const card = await createdResult(page, 'nested.zip', 'inner.zip', () =>
    page.getByRole('button', { name: 'Extract: inner.zip' }).click());
  await reinput(page, card, 'inner.zip');
  await browse(page, ['inside.txt']);
  await extract(page, 'inner.zip', 'inside.txt', 'nested content\n');
  checkpoint();
}
