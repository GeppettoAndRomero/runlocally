import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ImageErrorCode } from '../../src/engine/image/types';
import { imageTool, imageToolContent, type ImageToolStrings } from '../../src/i18n/image-tool';
import { LOCALES } from '../../src/i18n/locales';

const errorKeys = {
  'unsupported-type': true,
  'decode-failed': true,
  'heic-decoder-unavailable': true,
  'too-large': true,
  'out-of-memory': true,
  'encode-failed': true,
  interrupted: true,
} satisfies Record<ImageErrorCode, true>;

describe('image tool dictionaries', () => {
  it('has exact locale, group and nested key sets with bounded nonblank strings', () => {
    expect(Object.keys(imageTool).sort()).toEqual(LOCALES.map(locale => locale.code).sort());
    const groups = {
      labels: ['outputFormat', 'selectImages'],
      formats: ['jpg', 'png'],
      input: ['dropZone'],
      statuses: ['waiting', 'converting', 'saved', 'failed'],
      notices: ['metadata', 'onDevice', 'chrome', 'safari', 'avif', 'heic'],
      errors: ['unsupported-type', 'decode-failed', 'heic-decoder-unavailable',
        'too-large', 'out-of-memory', 'encode-failed', 'interrupted'],
    } satisfies { [Group in keyof ImageToolStrings]: Array<keyof ImageToolStrings[Group]> };
    for (const { code } of LOCALES) {
      const content = imageToolContent(code);
      expect(content).toBe(imageTool[code]);
      expect(Object.keys(content).sort()).toEqual(Object.keys(groups).sort());
      for (const [group, values] of Object.entries(content)) {
        expect(Object.keys(values).sort()).toEqual([...Reflect.get(groups, group)].sort());
        const limit = group === 'notices' ? 240 : group === 'input' || group === 'errors' ? 160 : 32;
        for (const value of Object.values(values)) {
          if (typeof value !== 'string') throw new Error(`Expected a string in ${code}/${group}`);
          expect(value.trim()).not.toBe('');
          expect(Array.from(value).length).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it('requires every engine error code in both locales at compile time', () => {
    expectTypeOf<keyof ImageToolStrings['errors']>().toEqualTypeOf<ImageErrorCode>();
    expectTypeOf<keyof typeof imageTool.ja.errors>().toEqualTypeOf<ImageErrorCode>();
    expectTypeOf<keyof typeof imageTool.en.errors>().toEqualTypeOf<ImageErrorCode>();
    const { interrupted: _interrupted, ...missingError } = imageTool.en.errors;
    // @ts-expect-error Every engine error requires a translation.
    const _incomplete: ImageToolStrings['errors'] = missingError;
    expect(_incomplete).toBe(missingError);
    expect(Object.keys(missingError).sort()).toEqual(Object.keys(errorKeys).filter(key => key !== 'interrupted').sort());
  });
});
