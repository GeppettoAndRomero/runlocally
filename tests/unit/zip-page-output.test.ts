import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { pageContent } from '../../src/i18n/pages';
import { pagePath } from '../../src/seo/page';
import { ZIP_PAGES } from '../../src/seo/url-model';

const output = join(process.cwd(), 'dist');

// The served HTML carries the page's own operation panel and navigation only. The other panels mount after
// hydration (src/app/Workbench.tsx) and the navigation follows a language change (src/app/page-display.ts).
for (const { code } of LOCALES) for (const current of ZIP_PAGES) {
  test(`${code}/${current} serves only its own operation panel and language`, () => {
    const html = readFileSync(join(output, pagePath(code, current).slice(1), 'index.html'), 'utf8');
    const document: Document = new JSDOM(html).window.document;
    const own = current === 'top' ? 'browse' : current;

    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    expect(panels.map(panel => panel.id)).toEqual([`panel-${own}`]);
    expect(panels[0].hasAttribute('hidden')).toBe(false);
    for (const op of AVAILABLE_OPS.filter(entry => entry.id !== own)) {
      expect(document.getElementById(`panel-${op.id}`)).toBeNull();
    }
    // The menu is navigation, not panel content: it still lists every operation.
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(AVAILABLE_OPS.length);

    expect(document.querySelectorAll('[data-operation-cards]')).toHaveLength(1);
    const text = document.body.textContent ?? '';
    for (const other of LOCALES.filter(entry => entry.code !== code)) {
      for (const op of AVAILABLE_OPS) {
        expect(text).not.toContain(pageContent(other.code, op.id).description);
      }
    }
  });
}
