import { expect, it } from 'vitest';
import { imageCapability, imageCapabilityLimits, validateImageCapability } from '../../src/i18n/image-capability';

it('fixes locales, keys and code point limits', () => {
  expect(Object.keys(imageCapability)).toEqual(['ja', 'en']);
  expect(imageCapabilityLimits).toEqual({ heading: 64,
    formats: { png: 16, jpeg: 16, gif: 16, webp: 16, bmp: 16, ico: 16, avif: 16 },
    checking: 24, readable: 24, unreadable: 24, heic: 24, fallback: 160, note: 320 });
  for (const content of Object.values(imageCapability)) expect(() => validateImageCapability(content)).not.toThrow();
});
it('rejects missing, extra, empty and overlong values including nested keys', () => {
  const { note: _note, ...missing } = imageCapability.en;
  for (const content of [null, missing, { ...imageCapability.en, extra: 'x' },
    { ...imageCapability.en, heading: ' ' }, { ...imageCapability.en, formats: {} },
    { ...imageCapability.en, heading: '😀'.repeat(65) }]) {
    expect(() => validateImageCapability(content)).toThrow();
  }
  expect(() => validateImageCapability({ ...imageCapability.en, heading: '😀'.repeat(64) })).not.toThrow();
  const { png: _png, ...formats } = imageCapability.en.formats;
  expect(() => validateImageCapability({ ...imageCapability.en, formats: { ...formats, other: 'x' } })).toThrow();
});
