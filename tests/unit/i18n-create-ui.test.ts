import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { OPS } from '../../src/i18n/ops';
import { pages } from '../../src/i18n/pages';
import { createUi, menuUi, ui, validateCreateStrings } from '../../src/i18n/ui';
import { ui as jaDictionary } from '../../src/i18n/ja/ui';
import { ui as enDictionary } from '../../src/i18n/en/ui';
import type { CreateStringKey } from '../../src/i18n/types';

const keys = [
  'title', 'addFiles', 'addFolder', 'selectedCount', 'emptyGuide', 'run', 'clearSelection',
  'processingFile', 'resultSummary', 'save', 'tooLarge', 'emptySelection', 'failure', 'retryGuide',
] as const satisfies readonly CreateStringKey[];

describe('create strings', () => {
  it('covers every supported locale and exactly the required keys', () => {
    expect(Object.keys(createUi).sort()).toEqual(LOCALES.map(locale => locale.code).sort());
    expect(Object.keys(createUi.ja).sort()).toEqual(Object.keys(createUi.en).sort());
    for (const { code } of LOCALES) {
      expect(Object.keys(createUi[code]).sort()).toEqual([...keys].sort());
      const values = Object.values(createUi[code]);
      for (const value of values) {
        expect(typeof value).toBe('string');
        expect(value.trim()).not.toBe('');
        expect(value).not.toMatch(/[{}]/);
      }
      expect(new Set(values.map(value => value.trim())).size).toBe(values.length);
      expect(() => validateCreateStrings(code, createUi[code])).not.toThrow();
    }
  });

  it('uses locale dictionaries without widening the existing UI export', () => {
    expect(createUi.ja).toBe(jaDictionary.create);
    expect(createUi.en).toBe(enDictionary.create);
    for (const { code } of LOCALES) {
      expect(Object.keys(ui[code]).sort()).toEqual(['shared', 'workbench']);
      expect(menuUi[code]).not.toHaveProperty('create');
      expect(pages[code]).not.toHaveProperty('create');
    }
    expect(OPS.find(op => op.id === 'create')?.available).toBe(false);
  });

  it.each(LOCALES.map(locale => locale.code))('rejects missing and extra keys for %s', code => {
    for (const key of keys) {
      const incomplete: Record<string, unknown> = { ...createUi[code] };
      delete incomplete[key];
      expect(() => validateCreateStrings(code, incomplete)).toThrow(`Missing UI text: ${code}/create/${key}`);
    }
    expect(() => validateCreateStrings(code, { ...createUi[code], extra: 'Extra' }))
      .toThrow(`Unexpected UI text: ${code}/create/extra`);
  });

  it.each(LOCALES.map(locale => locale.code))('rejects empty and non-string values for %s', code => {
    for (const key of keys) {
      for (const value of ['', ' \t\n ', undefined, null, 0, {}, [], () => 'Text']) {
        expect(() => validateCreateStrings(code, { ...createUi[code], [key]: value }))
          .toThrow(`Missing UI text: ${code}/create/${key}`);
      }
    }
  });

  it('rejects absent or malformed sections', () => {
    for (const value of [undefined, null, '', 0, [], () => enDictionary.create]) {
      expect(() => validateCreateStrings('en', value)).toThrow('Missing UI text: en/create');
    }
  });
});
