import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/locales';

describe('locales', () => {
  it('includes the default locale among the supported locales', () => {
    expect(LOCALES.map(locale => locale.code)).toContain(DEFAULT_LOCALE);
  });

  it('has no duplicate locale codes', () => {
    expect(new Set(LOCALES.map(locale => locale.code)).size).toBe(LOCALES.length);
  });
});
