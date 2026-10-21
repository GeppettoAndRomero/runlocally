import { expect, test, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const path of ['/image/', '/en/image/']) {
  test(`${path} drops through the overlay once on the frame, child and input`, async ({ page }) => {
    await page.goto(path);
    await page.waitForFunction(() => window.__toolReady === true);
    const area = page.locator('.image-drop-area');
    const bytes = [...await readFile('tests/fixtures/image/alpha.png')];
    const downloads: Download[] = [];
    page.on('download', download => downloads.push(download));
    for (const [index, selector] of ['.image-drop-area', '.image-drop-area strong', 'input[type=file]'].entries()) {
      const data = await page.evaluateHandle(bytes => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], 'picture.png', { type: 'image/png' }));
        return transfer;
      }, bytes);
      const target = page.locator(selector);
      await target.dispatchEvent('dragenter', { dataTransfer: data });
      await target.dispatchEvent('dragover', { dataTransfer: data });
      await expect(area).toHaveClass(/is-dragging/);
      await expect(area).toContainText(path === '/image/' ? '放して追加' : 'Release to add');
      await expect(page.locator('.global-drop-zone')).toBeVisible();
      await target.dispatchEvent('drop', { dataTransfer: data });
      await expect(area).not.toHaveClass(/is-dragging/);
      await expect(page.locator('.global-drop-zone')).toHaveCount(0);
      await expect.poll(() => downloads.length).toBe(index + 1);
      await expect(page.locator('.image-converter li')).toHaveCount(index + 1);
      await expect(page.locator('input[value=png]')).toBeEnabled();
      expect(await downloads[index].failure()).toBeNull();
      const output = await readFile((await downloads[index].path())!);
      expect([...output.subarray(0, 3)]).toEqual([255, 216, 255]);
      await data.dispose();
    }
    expect(downloads).toHaveLength(3);
  });

  test(`${path} supports native picker click, Enter and Space`, async ({ page, browserName }) => {
    await page.goto(path);
    await page.waitForFunction(() => window.__toolReady === true);
    const input = page.locator('input[type=file]');
    const choose = async (action: () => Promise<unknown>) => {
      const pending = page.waitForEvent('filechooser');
      await action();
      const picker = await pending;
      expect(picker.isMultiple()).toBe(true);
      await picker.setFiles([]);
    };
    await choose(() => page.locator('.image-drop-area strong').click());
    // Reach the native input through sequential keyboard navigation. WebKit skips file inputs
    // in Tab order by platform default, so there the input is focused directly.
    await page.locator('input[value=png]').focus();
    if (browserName === 'webkit') await input.focus(); else await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await choose(() => page.keyboard.press('Enter'));
    await input.focus();
    await choose(() => page.keyboard.press('Space'));
  });

  test(`${path} fits 360px with theme tokens, visible focus and reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto(path);
      await page.waitForFunction(() => window.__toolReady === true);
      await page.locator('input[type=file]').focus();
      const style = await page.locator('.image-drop-area').evaluate(element => {
        const css = getComputedStyle(element);
        const token = (name: string, property: string) => {
          const probe = document.createElement('span');
          probe.style.setProperty(property, `var(${name})`); element.append(probe);
          const value = getComputedStyle(probe).getPropertyValue(property); probe.remove(); return value;
        };
        return { fits: document.documentElement.scrollWidth <= innerWidth,
          background: css.backgroundColor, surface: token('--color-surface', 'background-color'),
          outline: css.outlineColor, focus: token('--color-focus', 'color'),
          outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth,
          animation: css.animationName, transition: css.transitionDuration, transform: css.transform };
      });
      expect(style.fits).toBe(true); expect(style.background).toBe(style.surface);
      expect(style.outline).toBe(style.focus); expect(style.outlineStyle).toBe('solid');
      expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);
      // The global reduced-motion rule clamps durations to 0.01ms rather than removing them.
      expect(style.animation).toBe('none'); expect(parseFloat(style.transition)).toBeLessThanOrEqual(0.00001); expect(style.transform).toBe('none');
    }
  });
}
