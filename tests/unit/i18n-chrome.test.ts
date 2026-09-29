import { describe, expect, it } from 'vitest';
import { chromeUi, ui } from '../../src/i18n/ui';
import { ENGLISH_LOCALE, LOCALES } from '../../src/i18n/locales';
import type { ChromeStringKey, UiStrings } from '../../src/i18n/types';

const keys = ['navigation', 'home', 'languages'] as const satisfies readonly ChromeStringKey[];
const section: UiStrings['chrome'] = chromeUi[ENGLISH_LOCALE];

describe('chrome dictionary', () => {
  it('has every finite key and nonempty translation in every locale', () => {
    expect(Object.keys(section).sort()).toEqual([...keys].sort());
    expect(Object.keys(chromeUi).sort()).toEqual(LOCALES.map(entry => entry.code).sort());
    for (const entry of LOCALES) {
      expect(Object.keys(chromeUi[entry.code]).sort()).toEqual([...keys].sort());
      expect(Object.values(chromeUi[entry.code]).every(value => value.trim().length > 0)).toBe(true);
      expect(Object.keys(ui[entry.code]).sort()).toEqual(['shared', 'workbench']);
    }
  });
});
