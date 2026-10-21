import type { ImageResult } from './types';

// The canvas area ceiling used by iOS Safari; do not silently resize.
export const MAX_IMAGE_PIXELS = 16_777_216;

export function checkImageDimensions(width: number, height: number): ImageResult<null> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, code: 'decode-failed' };
  }
  return width > MAX_IMAGE_PIXELS / height
    ? { ok: false, code: 'too-large' } : { ok: true, value: null };
}
