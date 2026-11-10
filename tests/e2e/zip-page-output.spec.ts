import { expect, test } from '@playwright/test';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { pages as enPages } from '../../src/i18n/en/pages';
import { pages as jaPages } from '../../src/i18n/ja/pages';
import { pagePath } from '../../src/seo/page';
import { ZIP_PAGES } from '../../src/seo/url-model';
import { ready } from './_helpers';
import { zipHome } from './_paths';

const contents = { ja: jaPages, en: enPages };

test('without JavaScript each ZIP page serves its own panel and its own language', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', baseURL });
  const page = await context.newPage();
  try {
    for (const { code } of LOCALES) for (const current of ZIP_PAGES) {
      await page.goto(pagePath(code, current));
      const own = current === 'top' ? 'browse' : current;
      await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);
      await expect(page.locator(`#panel-${own}`)).toHaveCount(1);
      const cards = page.locator('[data-operation-cards]');
      await expect(cards).toHaveCount(1);
      await expect(cards).toHaveAttribute('data-lang', code);
    }
  } finally { await context.close(); }
});

// Each language switch at the ZIP top follows the visible cards; every panel is mounted after hydration.
for (const width of [360, 1280]) {
  test(`at ${width}px the panels mount after hydration and the cards follow the language`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(zipHome('ja'));
    await ready(page);
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(AVAILABLE_OPS.length);
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);

    await page.locator('.workbench__language select').selectOption('en');
    const cards = page.locator('[data-operation-cards]:visible');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAttribute('data-lang', 'en');
    await expect(cards.locator('article h2 > a').first()).toHaveAttribute('href', pagePath('en', AVAILABLE_OPS[0].id));
    await expect(cards.locator('article p').first()).toHaveText(contents.en[AVAILABLE_OPS[0].id].description);

    await page.locator('.workbench__language select').selectOption('ja');
    await expect(cards).toHaveAttribute('data-lang', 'ja');
    await expect(cards.locator('article p').first()).toHaveText(contents.ja[AVAILABLE_OPS[0].id].description);
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(AVAILABLE_OPS.length);
  });
}
