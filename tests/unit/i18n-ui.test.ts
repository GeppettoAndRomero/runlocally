import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ui } from '../../src/i18n/ui';
import { ENGLISH_LOCALE, LOCALES } from '../../src/i18n/locales';

// Fingerprints of every value in the two original dictionaries, including spaces and tokens.
const original = {
  ja: { workbench: '5ecec6702d3e83a41d01c19366dac2f19c168c3dabc84d8975b47e69b16e7f52', shared: 'c01800fcc094f5eadba7df01301fae4ad6460f15f38f2fdce854cbc9a431dfef' },
  en: { workbench: '20bc06b5a8f234e8619dfe9821c7342e0edd4dcd359166fc71cef1aa607d7447', shared: 'e4507682805cc5736ee5040a6015f93cd55ea4e70dfd842584de6e813a3b257c' },
} as const;

describe('localized UI dictionaries', () => {
  it('covers every supported locale and both finite sections', () => {
    expect(Object.keys(ui).sort()).toEqual(LOCALES.map(locale => locale.code).sort());
    const sections = ['shared', 'workbench'] as const;
    for (const locale of LOCALES) {
      expect(Object.keys(ui[locale.code]).sort()).toEqual([...sections].sort());
      for (const section of sections) {
        expect(Object.keys(ui[locale.code][section]).sort()).toEqual(Object.keys(ui[ENGLISH_LOCALE][section]).sort());
      }
      expect(Object.values(ui[locale.code].workbench).every(value => value.length > 0)).toBe(true);
      expect(Object.values(ui[locale.code].shared).every(value => value.length > 0)).toBe(true);
      expect(ui[locale.code].shared.security.trim()).not.toBe('');
    }
  });

  it('preserves every pre-migration UI value', () => {
    for (const locale of ['ja', 'en'] as const) {
      for (const section of ['workbench', 'shared'] as const) {
        const digest = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(ui[locale][section]).filter(([key]) => key !== 'language' && key !== 'security' && key !== 'corrupt-entry')))).digest('hex');
        expect(digest).toBe(original[locale][section]);
      }
    }
  });
});
