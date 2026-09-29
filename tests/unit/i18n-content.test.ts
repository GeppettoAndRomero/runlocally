import { describe, expect, it } from 'vitest';
import { AVAILABLE_OPS, OPS } from '../../src/i18n/ops';
import { pages as ja } from '../../src/i18n/ja/pages';
import { pages as en } from '../../src/i18n/en/pages';

const expected = ['top', ...AVAILABLE_OPS.map(op => op.i18nKey)].sort();

describe.each([['ja', ja], ['en', en]] as const)('%s page content', (_locale, pages) => {
  it('covers exactly the available operations', () => {
    expect(Object.keys(pages).sort()).toEqual(expected);
    for (const op of OPS.filter(op => !op.available)) expect(Object.keys(pages)).not.toContain(op.i18nKey);
  });

  it('provides populated copy and structured guidance', () => {
    for (const page of Object.values(pages)) {
      for (const key of ['title', 'description', 'h1', 'lead'] as const) expect(page[key].trim()).not.toBe('');
      expect(page.steps.length).toBeGreaterThan(0);
      expect(page.faq.length).toBeGreaterThan(0);
      expect(page.limits.length).toBeGreaterThan(0);
      for (const step of page.steps) {
        expect(step.heading.trim()).not.toBe('');
        expect(step.body.trim()).not.toBe('');
      }
      for (const item of page.faq) {
        expect(item.question.trim()).not.toBe('');
        expect(item.answer.trim()).not.toBe('');
      }
      for (const limit of page.limits) expect(limit.trim()).not.toBe('');
      expect(JSON.stringify(page)).not.toMatch(/https?:\/\//);
    }
  });
});
