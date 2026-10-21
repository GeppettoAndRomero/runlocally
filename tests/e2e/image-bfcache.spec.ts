import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

declare global {
  interface Window {
    __releaseFolderScan?: () => void;
  }
}

for (const intake of ['picker', 'drop', 'paste', 'folder'] as const) {
  test(`real BFCache discards old ${intake} input and accepts fresh input`, async ({ page }) => {
    const downloads: string[] = [];
    page.on('download', download => downloads.push(download.suggestedFilename()));
    await page.addInitScript(() => {
      window.addEventListener('pageshow', event => {
        sessionStorage.setItem('image-pageshow-persisted', String(event.persisted));
      });
    });
    // Automation often disables the back/forward cache; without a real restoration nothing here is validated.
    await page.goto('/image/');
    await page.waitForFunction(() => window.__toolReady === true);
    await page.goto('/');
    await page.goBack();
    const eligible = await page.evaluate(() => sessionStorage.getItem('image-pageshow-persisted'));
    test.skip(eligible !== 'true', 'The back/forward cache did not restore the page in this automated browser; BFCache behavior is unverified here.');
    await page.evaluate(() => sessionStorage.removeItem('image-pageshow-persisted'));
    // Keep actual decoding pending until after the round trip.
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/image-worker-*.js', async route => { await blocked; await route.continue(); });
    await page.goto('/image/');
    await page.waitForFunction(() => window.__toolReady === true);
    const bytes = [...await readFile('tests/fixtures/image/alpha.png')];
    try {
      if (intake === 'picker') {
        await page.locator('input[type=file]').setInputFiles({ name: 'old.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
      } else {
        await page.evaluate(({ intake, bytes }) => {
          const file = new File([new Uint8Array(bytes)], 'old.png', { type: 'image/png' });
          const transfer = new DataTransfer(); transfer.items.add(file);
          if (intake === 'paste') {
            document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
          } else {
            if (intake === 'folder') {
              // Delay a browser directory reader callback across a real departure.
              const child = { isFile: true, isDirectory: false, fullPath: '/folder/old.png',
                file: (done: (file: File) => void) => done(file) };
              const entry = { isFile: false, isDirectory: true, fullPath: '/folder', createReader: () => {
                let completed = false;
                return { readEntries: (done: (entries: object[]) => void) => {
                  if (completed) done([]);
                  else { completed = true; window.__releaseFolderScan = () => done([child]); }
                } };
              } };
              Object.defineProperty(transfer.items[0], 'webkitGetAsEntry', { value: () => entry });
            }
            document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
          }
        }, { intake, bytes });
        if (intake === 'folder') await page.waitForFunction(() => Boolean(window.__releaseFolderScan));
      }
      await page.goto('/');
      await page.goBack();
      expect(await page.evaluate(() => sessionStorage.getItem('image-pageshow-persisted')),
        'This must be an actual BFCache restoration; reload is not validation').toBe('true');
      await page.waitForFunction(() => window.__toolReady === true);
      if (intake === 'folder') await page.evaluate(() => window.__releaseFolderScan?.());
    } finally { release(); }
    // Fresh input drains after any stale work, so its completion is the barrier.
    const fresh = page.waitForEvent('download');
    await page.locator('input[type=file]').setInputFiles({ name: 'fresh.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
    expect((await fresh).suggestedFilename()).toBe('fresh.jpg');
    await expect(page.locator('input[value=png]')).toBeEnabled();
    expect(downloads).toEqual(['fresh.jpg']);
  });
}
