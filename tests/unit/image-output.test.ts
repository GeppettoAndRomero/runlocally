import { describe, expect, expectTypeOf, it } from 'vitest';
import { IMAGE_OUTPUT_SPECS, imageOutputName } from '../../src/engine/image/output';
import type { ImageErrorCode, ImageResult } from '../../src/engine/image/types';

describe('image output contract', () => {
  it('requires JPG quality and white compositing, PNG alpha and no quality', () => {
    expect(IMAGE_OUTPUT_SPECS.jpg).toEqual({ format: 'jpg', extension: '.jpg', mime: 'image/jpeg',
      quality: 0.92, background: '#ffffff', reencode: true });
    expect(IMAGE_OUTPUT_SPECS.png).toEqual({ format: 'png', extension: '.png', mime: 'image/png',
      preserveAlpha: true, reencode: true });
    expect(IMAGE_OUTPUT_SPECS.png).not.toHaveProperty('quality');
    expect(Object.isFrozen(IMAGE_OUTPUT_SPECS)).toBe(true);
    expect(Object.isFrozen(IMAGE_OUTPUT_SPECS.jpg)).toBe(true);
    expect(Object.isFrozen(IMAGE_OUTPUT_SPECS.png)).toBe(true);
  });
  it.each([
    ['photo.heic', 'photo'], ['photo.edit.webp', 'photo.edit'], ['photo', 'photo'],
    ['.hidden', '.hidden'], ['.hidden.png', '.hidden'], ['', 'image'], ['.', 'image'],
    ['..', 'image'], ['...jpg', 'image'], ['photo.', 'photo'], ['photo..png', 'photo.'],
    ['写真.編集.webp', '写真.編集'], ['a/b/photo.png', 'photo'], ['a\\b\\photo.jpg', 'photo'],
    ['a/b/', 'image'], ['a\\', 'image'], ['a/../.png', '.png'],
  ])('names %s from its leaf and last extension', (input, base) => {
    expect(imageOutputName(input, 'jpg')).toBe(`${base}.jpg`);
    expect(imageOutputName(input, 'png')).toBe(`${base}.png`);
  });
  it('requires re-encoding even when the name and format already match', () => {
    for (const format of ['jpg', 'png'] as const) {
      expect(imageOutputName(`photo.${format}`, format)).toBe(`photo.${format}`);
      expect(IMAGE_OUTPUT_SPECS[format].reencode).toBe(true);
    }
  });
  it('uses a discriminated result and exactly seven failure codes', () => {
    expectTypeOf<ImageErrorCode>().toEqualTypeOf<
      'unsupported-type' | 'decode-failed' | 'heic-decoder-unavailable' |
      'too-large' | 'out-of-memory' | 'encode-failed' | 'interrupted'
    >();
    const result: ImageResult<number> = { ok: true, value: 3 };
    const failure: ImageResult<number> = { ok: false, code: 'too-large' };
    expect(result.ok && result.value).toBe(3);
    expect(!failure.ok && failure.code).toBe('too-large');
  });
});
