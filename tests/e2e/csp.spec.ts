import { createHash } from 'node:crypto';
import { test, expect, type BrowserContext } from '@playwright/test';
import { ready, roundTrip } from './_helpers';
import { activeRootWorker, assertOperationSupport, offline, publicPaths, url, visit } from './_covenant-support';

type Violation = { directive: string; blockedURI: string; source: string; line: number; phase: string };
async function observe(context: BrowserContext) {
  const violations: Violation[] = [];
  let phase = 'initial navigation';
  await context.exposeBinding('__recordViolation', (_source, item: Omit<Violation, 'phase'>) => {
    violations.push({ ...item, phase });
  });
  await context.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', event => {
      void (window as typeof window & { __recordViolation: (item: object) => Promise<void> }).__recordViolation({
        directive: event.effectiveDirective, blockedURI: event.blockedURI,
        source: event.sourceFile, line: event.lineNumber,
      });
    });
  });
  return {
    violations,
    setPhase(value: string) { phase = value; },
    clean() { expect(violations, 'Unexpected content policy violation').toEqual([]); },
  };
}

async function headersAndInjection(context: BrowserContext, path: string) {
  const response = await context.request.get(url(path), { maxRedirects: 0 });
  expect(response.ok(), path).toBe(true);
  const headers = response.headers();
  expect(headers['content-security-policy'], path).toBeTruthy();
  for (const name of ['nel', 'report-to', 'reporting-endpoints']) expect(headers[name], `${path}: ${name}`).toBeUndefined();
  // The body is read without the service worker, so an edge-injected beacon cannot hide behind a precached page.
  expect(await response.text(), `${path}: analytics injection`).not.toMatch(/cloudflareinsights|data-cf-beacon|\/cdn-cgi\/(?:rum|beacon)/i);
}

test.beforeEach(assertOperationSupport);

test('published operations have no policy violations or reporting injection', async ({ browser, browserName }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true });
  const observed = await observe(context);
  try {
    const page = await context.newPage();
    for (const path of publicPaths) {
      await headersAndInjection(context, path);
      observed.setPhase(`page ${path}`);
      await visit(page, path);
      await expect(page.locator('script[src*="cloudflareinsights"], script[data-cf-beacon], [src*="/cdn-cgi/rum"], [src*="/cdn-cgi/beacon"]')).toHaveCount(0);
      observed.clean();
    }
    observed.setPhase('online operations');
    await visit(page, '/en/');
    await roundTrip(page, observed.clean);
    observed.clean();
    if (browserName === 'chromium') {
      await activeRootWorker(page);
      await offline(context, async () => {
        observed.setPhase('offline operations');
        await page.reload(); await ready(page);
        await roundTrip(page, observed.clean);
      });
    }
    observed.clean();
  } finally { await context.setOffline(false); await context.close(); }
});

for (const probe of [
  { name: 'inline script', code: 'window.__probeRan = true', expected: /script-src/, blocked: /^inline/ },
  { name: 'blob script', code: "const blob = new Blob(['window.__probeRan = true'], { type: 'text/javascript' }); const script = document.createElement('script'); script.src = URL.createObjectURL(blob); document.head.append(script)", expected: /script-src/, blocked: /^blob/ },
  { name: 'blob worker', code: "const blob = new Blob(['self.postMessage(1)'], { type: 'text/javascript' }); new Worker(URL.createObjectURL(blob))", expected: /worker-src/, blocked: /^blob/ },
  { name: 'external fetch', code: "fetch('https://probe.invalid/csp-check').catch(() => undefined)", expected: /connect-src/, blocked: /probe\.invalid/ },
] as const) {
  test(`detector sees browser rejection: ${probe.name}`, async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const observed = await observe(context);
    observed.setPhase(probe.name);
    const path = '/__csp_probe__/';
    try {
      const source = await context.request.get(url('/en/'));
      const policy = source.headers()['content-security-policy'];
      expect(policy).toBeTruthy();
      const allowBootstrap = probe.name !== 'inline script';
      const hash = createHash('sha256').update(probe.code).digest('base64');
      const adjusted = allowBootstrap ? policy.replace(/script-src ([^;]*)/, (_match, value: string) => `script-src ${value} 'sha256-${hash}'`) : policy;
      expect(adjusted.match(/connect-src ([^;]*)/)?.[1]).toBe(policy.match(/connect-src ([^;]*)/)?.[1]);
      await context.route('https://probe.invalid/**', route => route.abort());
      await context.route(`**${path}`, route => route.fulfill({
        status: 200, contentType: 'text/html', headers: { 'content-security-policy': adjusted },
        body: `<!doctype html><meta charset="utf-8"><script>${probe.code}</script>`,
      }));
      const page = await context.newPage();
      await page.goto(url(path));
      await expect.poll(() => observed.violations.filter(item => probe.expected.test(item.directive)), { timeout: 10_000 }).not.toHaveLength(0);
      expect(observed.violations.some(item => item.phase === probe.name && probe.expected.test(item.directive) && probe.blocked.test(item.blockedURI))).toBe(true);
      if (probe.name === 'external fetch') expect(observed.violations.some(item => item.blockedURI.includes('probe.invalid'))).toBe(true);
    } finally { await context.close(); }
  });
}
