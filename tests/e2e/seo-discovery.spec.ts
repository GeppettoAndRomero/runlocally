import { expect, test } from '@playwright/test';
import { LOCALES, DEFAULT_LOCALE } from '../../src/i18n/locales';
import { notFoundContent } from '../../src/i18n/not-found';
import { AVAILABLE_OPS, operationLabel } from '../../src/i18n/ops';
import { ui as enUi } from '../../src/i18n/en/ui';
import { ui as jaUi } from '../../src/i18n/ja/ui';
import { pagePath } from '../../src/seo/page';
import { url, visit } from './_covenant-support';

const ui = { ja: jaUi, en: enUi };
const menuUi = { ja: jaUi.menu, en: enUi.menu };

test.describe('unmatched URLs', () => {
  for (const path of ['/no-such-page/', '/zip/unknown/', '/en/nothing', '/sitemap.xml.bak']) {
    test(`${path} answers 404 with the bilingual not-found document`, async ({ page }) => {
      const response = await page.goto(url(path));
      expect(response?.status()).toBe(404);
      expect(response?.headers()['content-type']).toMatch(/^text\/html/);
      await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      for (const { code } of LOCALES) {
        const content = notFoundContent(code);
        const section = page.locator(`[data-not-found-locale="${code}"]`);
        await expect(section.locator('h1')).toHaveText(content.heading);
        await expect(section.locator(`a[href="${pagePath(code, 'hub')}"]`)).toHaveText(content.hubLink);
        await expect(section.locator(`a[href="${pagePath(code, 'top')}"]`)).toHaveText(content.zipLink);
      }
      await expect(page.locator('body')).not.toContainText('ImageConverter');
      await expect(page.locator('[data-chrome-home]')).toHaveAttribute('href', pagePath(DEFAULT_LOCALE, 'hub'));
    });
  }

  test('not-found links reach the hub and the ZIP tool', async ({ page }) => {
    await page.goto(url('/no-such-page/'));
    await page.locator('[data-not-found-locale="en"]').locator(`a[href="${pagePath('en', 'top')}"]`).click();
    await expect(page).toHaveURL(url(pagePath('en', 'top')));
    await expect(page.locator('#page-heading')).toBeVisible();
  });

  test('the retired sitemap path redirects once to the current index', async ({ request }) => {
    const response = await request.get(url('/sitemap.xml'), { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toBe(url('/sitemap-index.xml'));
    const index = await request.get(url('/sitemap-index.xml'));
    expect(index.status()).toBe(200);
    expect(await index.text()).toContain('<sitemapindex');
  });
});

for (const { code } of LOCALES) {
  test(`${code} hub links every available ZIP operation and each link opens its page`, async ({ page }) => {
    await visit(page, pagePath(code, 'hub'));
    const links = page.locator('.hub-card').first().locator('[data-hub-operations] a');
    await expect(links).toHaveCount(AVAILABLE_OPS.length);
    for (const [index, op] of AVAILABLE_OPS.entries()) {
      await expect(links.nth(index)).toHaveAttribute('href', pagePath(code, op.id));
      await expect(links.nth(index)).toHaveText(operationLabel(op, ui[code].workbench, menuUi[code]));
    }
    const last = AVAILABLE_OPS[AVAILABLE_OPS.length - 1];
    await links.nth(AVAILABLE_OPS.length - 1).click();
    await expect(page).toHaveURL(url(pagePath(code, last.id)));
    await expect(page.locator(`[data-chrome-page="${last.id}"]`)).toHaveAttribute('aria-current', 'page');
  });

  test(`${code} hub keeps a narrow viewport free of horizontal overflow with the new links`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await visit(page, pagePath(code, 'hub'));
    await expect(page.locator('[data-hub-operations]')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
