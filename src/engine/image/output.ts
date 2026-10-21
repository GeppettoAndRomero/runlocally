import type { ImageOutputFormat, ImageOutputSpec } from './types';

// Always decode and re-encode, including same-format inputs; never pass through.
export const IMAGE_OUTPUT_SPECS = Object.freeze({
  jpg: Object.freeze({ format: 'jpg', extension: '.jpg', mime: 'image/jpeg',
    quality: 0.92, background: '#ffffff', reencode: true } as const),
  png: Object.freeze({ format: 'png', extension: '.png', mime: 'image/png',
    preserveAlpha: true, reencode: true } as const),
}) satisfies Readonly<Record<ImageOutputFormat, ImageOutputSpec>>;

/** Keep Unicode and internal dots verbatim; a leading dot alone is not an extension.
 * Strip either path separator, then replace the last extension (even an empty one).
 * Empty names and dot-only stems become image. Saving and collision handling are external.
 */
export function imageOutputName(inputName: string, format: ImageOutputFormat): string {
  const leaf = inputName.split(/[/\\]/).pop()!;
  const dot = leaf.lastIndexOf('.');
  const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
  const base = stem.replace(/\./g, '') === '' ? 'image' : stem;
  return base + IMAGE_OUTPUT_SPECS[format].extension;
}
