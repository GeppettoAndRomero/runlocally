export type ImageInputFormat =
  | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'ico'
  | 'avif' | 'heic' | 'heif' | 'unknown';
export type ImageOutputFormat = 'jpg' | 'png';

export type ImageOutputSpec = Readonly<
  | { format: 'jpg'; extension: '.jpg'; mime: 'image/jpeg'; quality: 0.92;
      background: '#ffffff'; reencode: true }
  | { format: 'png'; extension: '.png'; mime: 'image/png';
      preserveAlpha: true; reencode: true }
>;

export type ImageErrorCode =
  | 'unsupported-type' | 'decode-failed' | 'heic-decoder-unavailable'
  | 'too-large' | 'out-of-memory' | 'encode-failed' | 'interrupted';

// Pixel limits belong to the decoder policy. Exceeding them must return too-large,
// never silently resize the image. No numeric limit is chosen here.
export type ImageResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ImageErrorCode };
