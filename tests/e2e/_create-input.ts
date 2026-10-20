import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { configure, Uint8ArrayReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';

configure({ useWebWorkers: false });
export interface CreateFile { name: string; text: string; lastModified?: number; size?: number }

export async function chooseFiles(page: Page, files: readonly CreateFile[]) {
  await page.locator('#panel-create input[multiple]').setInputFiles(files.map(file => ({
    name: file.name, mimeType: 'text/plain', buffer: Buffer.from(file.text),
  })));
}

/**
 * Dispatch a DOM drop through the public intake. Simulated sizes are set on the File objects themselves, and
 * some browsers copy a File when it enters a DataTransfer and lose that override, so those files are passed to
 * the intake event directly. Plain drops still use the native drop path.
 */
export async function dropFiles(page: Page, files: readonly CreateFile[]) {
  await page.evaluate(items => {
    const made = items.map(item => {
      const file = new File([item.text], item.name, { type: 'text/plain', lastModified: item.lastModified ?? 1 });
      if (item.size !== undefined) Object.defineProperty(file, 'size', { value: item.size });
      return file;
    });
    if (items.some(item => item.size !== undefined)) {
      window.dispatchEvent(new CustomEvent('filesDropped', { detail: made }));
      return;
    }
    const data = new DataTransfer();
    for (const file of made) data.items.add(file);
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, files);
}

export async function saveCreated(page: Page, saveLabel = 'Save ZIP') {
  const download = page.waitForEvent('download');
  await page.locator('#panel-create').getByRole('button', { name: `${saveLabel}: created.zip`, exact: true }).click();
  const item = await download;
  expect(item.suggestedFilename()).toBe('created.zip');
  const path = await item.path();
  if (!path) throw new Error('Created ZIP download is missing');
  return readFile(path);
}

export async function zipContents(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const files: Record<string, Uint8Array> = {};
    for (const entry of await reader.getEntries()) {
      expect(entry.encrypted).toBe(false);
      if (!entry.directory) files[entry.filename] = await entry.getData!(new Uint8ArrayWriter());
    }
    return files;
  } finally { await reader.close(); }
}
