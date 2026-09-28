import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/locales';

describe('locales', () => {
  it('includes the default locale among the supported locales', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('has no duplicate locale codes', () => {
    expect(new Set(LOCALES).size).toBe(LOCALES.length);
  });
});
