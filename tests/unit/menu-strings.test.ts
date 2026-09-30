import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { menuUi, ui } from '../../src/i18n/ui';
import { ui as jaDictionary } from '../../src/i18n/ja/ui';
import { ui as enDictionary } from '../../src/i18n/en/ui';

const opKeys = AVAILABLE_OPS.map(op => op.i18nKey).sort();
const digest = (value: Record<string, string>) => createHash('sha256').update(JSON.stringify(
  Object.fromEntries(Object.entries(value).filter(([key]) =>
    key !== 'language' && key !== 'security' && key !== 'corrupt-entry')),
)).digest('hex');

describe('menu strings', () => {
  it('publishes exactly the supported locales and available operations', () => {
    expect(Object.keys(menuUi).sort()).toEqual(LOCALES.map(locale => locale.code).sort());
    expect(Object.keys(menuUi.ja).sort()).toEqual(Object.keys(menuUi.en).sort());
    for (const { code } of LOCALES) {
      expect(Object.keys(menuUi[code]).sort()).toEqual(opKeys);
      for (const op of opKeys) {
        const entry = menuUi[code][op];
        expect(Object.keys(entry).sort()).toEqual(['description', 'verb']);
        for (const field of ['verb', 'description'] as const) {
          expect(typeof entry[field]).toBe('string');
          expect(entry[field].trim()).not.toBe('');
        }
        expect(entry.verb.trim()).not.toBe(entry.description.trim());
      }
    }
  });

  it('uses locale dictionaries without widening the existing UI export', () => {
    expect(menuUi.ja).toBe(jaDictionary.menu);
    expect(menuUi.en).toBe(enDictionary.menu);
    for (const { code } of LOCALES) {
      expect(Object.keys(ui[code]).sort()).toEqual(['shared', 'workbench']);
    }
  });

  it('keeps the existing fingerprint inputs separate from menu text', () => {
    const before = Object.fromEntries(LOCALES.map(({ code }) => [code, {
      workbench: digest(ui[code].workbench),
      shared: digest(ui[code].shared),
    }]));
    const original = menuUi.ja.browse.verb;
    try {
      menuUi.ja.browse.verb = '内容を表示する';
      for (const { code } of LOCALES) {
        expect(digest(ui[code].workbench)).toBe(before[code].workbench);
        expect(digest(ui[code].shared)).toBe(before[code].shared);
      }
    } finally {
      menuUi.ja.browse.verb = original;
    }
  });
});
