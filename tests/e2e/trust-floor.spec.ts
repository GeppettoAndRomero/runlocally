import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { LOCALES, type Locale } from '../../src/i18n/locales';
import { pagePath, pageUrl } from '../../src/seo/page';
import type { SitePage } from '../../src/seo/url-model';
import { activeRootWorker, origin, url, visit } from './_covenant-support';

const { repository } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const copy = {
  ja: { free: '無料で使えるブラウザアプリです。',
    disclosure: 'コードの一部は AI の支援で書かれています。レビューと判断はすべて運営者が行っています。',
    source: 'ソースコード（GitHub）', issues: '不具合・ご意見（GitHub Issues）', security: 'セキュリティ',
    report: '脆弱性の報告は、下のセキュリティ窓口をご利用ください。' },
  en: { free: 'A free app that runs in your browser.',
    disclosure: "Some code was written with AI assistance; all review and decisions are the maintainer's.",
    source: 'Source code (GitHub)', issues: 'Bugs and feedback (GitHub Issues)', security: 'Security',
    report: 'To report a vulnerability, use the Security link below.' },
};
function observeExternal(context: BrowserContext) {
  const requests: string[] = [];
  // Request events include attempts that subsequently fail; Chromium also exposes SW requests.
  context.on('request', request => {
    if (new URL(request.url()).origin !== origin) requests.push(request.url());
  });
  return requests;
}
async function check(page: Page, locale: Locale, current: SitePage,
  { javaScriptEnabled = true, tabKey = 'Tab' } = {}) {
  const other = locale === 'ja' ? 'en' : 'ja';
  const footer = page.locator('.site-footer');
  const visible = footer.locator(`[data-trust-locale="${locale}"]`);
  const hidden = footer.locator(`[data-trust-locale="${other}"]`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(visible).toBeVisible();
  await expect(hidden).toBeHidden();
  for (const value of [copy[locale].free, copy[locale].disclosure, copy[locale].report]) {
    await expect(visible.getByText(value, { exact: true })).toBeVisible();
  }
  const source = footer.getByRole('link', { name: copy[locale].source, exact: true });
  const issues = footer.getByRole('link', { name: copy[locale].issues, exact: true });
  const security = footer.getByRole('link', { name: copy[locale].security, exact: true });
  await expect(source).toHaveAttribute('href', repository);
  await expect(issues).toHaveAttribute('href', `${repository}/issues`);
  await expect(security).toHaveAttribute('href', '/SECURITY.md');
  await expect(footer.getByRole('link')).toHaveCount(3);
  for (const kind of ['source', 'issues'] as const) {
    await expect(footer.getByRole('link', { name: copy[other][kind], exact: true })).toHaveCount(0);
    if (javaScriptEnabled) {
      const link = hidden.locator(`[data-trust-link="${kind}"]`);
      await link.evaluate(element => (element as HTMLElement).focus());
      await expect(link).not.toBeFocused();
    }
  }
  const tree = await footer.ariaSnapshot();
  expect(tree).toContain(copy[locale].source);
  expect(tree).not.toContain(copy[other].source);
  expect(tree).not.toContain(copy[other].issues);
  if (javaScriptEnabled) {
    await source.focus();
    await expect(source).toBeFocused();
    await page.keyboard.press(tabKey); await expect(issues).toBeFocused();
    await page.keyboard.press(tabKey); await expect(security).toBeFocused();
    await page.keyboard.press(`Shift+${tabKey}`); await expect(issues).toBeFocused();
    await page.keyboard.press(`Shift+${tabKey}`); await expect(source).toBeFocused();
    await page.keyboard.press(`Shift+${tabKey}`);
    expect(await hidden.evaluate(element => element.contains(document.activeElement))).toBe(false);
    await source.hover(); await issues.hover(); await issues.focus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const json = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? 'null');
  expect(json).toMatchObject({ '@type': current === 'hub' ? 'WebSite' : 'SoftwareApplication',
    url: pageUrl(locale, current), inLanguage: locale });
  if (current !== 'hub') {
    expect(json).toMatchObject({ offers: { '@type': 'Offer', price: 0, priceCurrency: 'JPY' },
      applicationCategory: 'UtilitiesApplication', operatingSystem: 'Web browser' });
    expect(json.featureList).toEqual(current === 'image' ? ['JPG', 'PNG'] : current === 'top' ? []
      : await page.locator('#page-content ol h2').allTextContents());
  }
  for (const element of [visible, source, issues, security]) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
}

test('localized footer follows direct routes, ZIP operations and history without external requests', async ({ page, context, browserName }) => {
  test.info().annotations.push({ type: 'capability', description: browserName === 'chromium'
    ? 'Context requests including service-worker traffic observed through precache and reload.'
    : 'Observable context requests checked; complete service-worker traffic is not observed.' });
  const external = observeExternal(context);
  // WebKit, like Safari, moves between links with Option+Tab; plain Tab skips links by default.
  const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const checkPage = (locale: Locale, current: SitePage) => check(page, locale, current, { tabKey });
  await page.setViewportSize({ width: 360, height: 800 });
  for (const { code } of LOCALES) for (const current of ['hub', 'top', 'image'] as const) {
    if (current === 'image') {
      await page.goto(url(pagePath(code, current)));
      await expect(page.locator('.site-footer')).toBeVisible();
    } else await visit(page, pagePath(code, current));
    if (browserName === 'chromium' && current === 'hub') await activeRootWorker(page);
    await checkPage(code, current);
  }
  await visit(page, pagePath('ja', 'top'));
  if (browserName === 'chromium') await activeRootWorker(page);
  await page.locator('[data-chrome-locale="en"]').click(); await checkPage('en', 'top');
  await page.goBack(); await checkPage('ja', 'top');
  await page.goForward(); await checkPage('en', 'top');
  await page.locator('[data-chrome-page="extract"]').click(); await checkPage('en', 'extract');
  await page.locator('select[aria-label="Language"]').selectOption('ja'); await checkPage('ja', 'extract');
  await page.waitForTimeout(1500);
  expect(external, 'including failed request attempts').toEqual([]);
});

test('ZIP footer works without JavaScript at 360px', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', baseURL,
    viewport: { width: 360, height: 800 } });
  const external = observeExternal(context);
  try {
    const page = await context.newPage();
    for (const { code } of LOCALES) {
      await page.goto(pagePath(code, 'top'));
      await check(page, code, 'top', { javaScriptEnabled: false });
    }
    await page.waitForTimeout(1500);
    expect(external, 'including failed request attempts').toEqual([]);
  } finally { await context.close(); }
});
