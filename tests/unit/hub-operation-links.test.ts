import { readFileSync } from 'node:fs';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS, operationLabel } from '../../src/i18n/ops';
import { menuUi, ui } from '../../src/i18n/ui';
import { pagePath } from '../../src/seo/page';

describe('hub operation links', () => {
  for (const { code } of LOCALES) {
    it(`${code} hub links every available ZIP operation directly from the ZIP card`, () => {
      const html = readFileSync(`dist${pagePath(code, 'hub')}index.html`, 'utf8');
      const document: Document = new JSDOM(html).window.document;
      const cards = document.querySelectorAll('.hub-card');
      expect(cards).toHaveLength(2);
      const list = cards[0].querySelector('[data-hub-operations]');
      expect(list?.tagName).toBe('UL');
      const links = [...list!.querySelectorAll('li > a')].map(link => [link.getAttribute('href'), link.textContent]);
      expect(links).toEqual(AVAILABLE_OPS.map(op => [pagePath(code, op.id), operationLabel(op, ui[code].workbench, menuUi[code])]));
      expect(new Set(links.map(([href]) => href)).size).toBe(AVAILABLE_OPS.length);
      // The card heading stays the first link so existing hub expectations keep pointing at the ZIP entry page.
      expect(cards[0].querySelector('a')?.getAttribute('href')).toBe(pagePath(code, 'top'));
      expect(cards[1].querySelector('[data-hub-operations]')).toBeNull();
    });
  }
});
