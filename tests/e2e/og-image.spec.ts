import { expect, test } from '@playwright/test';
import { ZIP_PAGES, pagePath } from '../../src/seo/url-model';
import { ui as ja } from '../../src/i18n/ja/ui';
import { ui as en } from '../../src/i18n/en/ui';
import { SITE_NAME, SITE_ORIGIN } from '../../src/seo/page';
import { ready } from './_helpers';

const chromeUi = { ja: ja.chrome, en: en.chrome };

for (const current of ZIP_PAGES) {
  test(`${current}: social image alt follows ZIP language changes without a reload`, async ({ page }) => {
    await page.goto(pagePath('ja', current));
    await ready(page);
    // A full document navigation would discard this sentinel.
    await page.evaluate(() => { document.documentElement.dataset.ogSentinel = 'retained'; });
    for (const locale of ['ja', 'en', 'ja'] as const) {
      await page.locator('.workbench__language select').selectOption(locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('data-og-sentinel', 'retained');
      for (const selector of ['meta[property="og:image:alt"]', 'meta[name="twitter:image:alt"]']) {
        await expect(page.locator(selector)).toHaveAttribute('content', `${SITE_NAME} — ${chromeUi[locale].home}`);
      }
      for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        await expect(page.locator(selector)).toHaveAttribute('content', `${SITE_ORIGIN}/icons/social-card.png`);
      }
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    }
  });
}
