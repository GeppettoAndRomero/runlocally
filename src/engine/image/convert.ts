import { checkImageDimensions } from './limits';
import { IMAGE_OUTPUT_SPECS } from './output';
import { sniffImageFormat } from './sniff';
import type { ImageErrorCode, ImageOutputFormat, ImageOutputSpec, ImageResult } from './types';

export type ImageContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect' | 'drawImage'>;
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  paint(context: ImageContext): void;
  close(): void;
}
export interface ImageCanvas {
  context: ImageContext | null;
  encode(spec: ImageOutputSpec): Promise<Blob | null>;
  release(): void;
}
// Adapters may report memory exhaustion only when their decoder can identify it.
export class ImageMemoryError extends Error {}

export type ImageStage = 'reading' | 'decoding' | 'heic-decoder-preparing' | 'drawing' | 'encoding';

export interface ImageAdapters {
  onStage?: (stage: ImageStage) => void;
  decode(input: Blob): Promise<DecodedImage>;
  canvas(width: number, height: number): ImageCanvas;
  rescueDecode?: (input: Blob, onStage?: (stage: ImageStage) => void) => Promise<ImageResult<DecodedImage>>;
  interrupted?: () => boolean;
}

export async function decodeNativeImage(input: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
  return { width: bitmap.width, height: bitmap.height,
    paint: context => context.drawImage(bitmap, 0, 0), close: () => bitmap.close() };
}

export function createOffscreenImageCanvas(width: number, height: number): ImageCanvas {
  const canvas = new OffscreenCanvas(width, height);
  try {
    return { context: canvas.getContext('2d'),
      encode: spec => canvas.convertToBlob({ type: spec.mime,
        ...('quality' in spec ? { quality: spec.quality } : {}) }),
      release() { canvas.width = 0; canvas.height = 0; } };
  } catch (error) {
    canvas.width = 0; canvas.height = 0;
    throw error;
  }
}

// The caller creates the DOM canvas; the engine never creates DOM elements.
type MainThreadCanvas = Pick<HTMLCanvasElement, 'width' | 'height' | 'toBlob'> & {
  getContext(contextId: '2d'): ImageContext | null;
};
export function mainThreadImageCanvas(factory: () => MainThreadCanvas): ImageAdapters['canvas'] {
  return (width, height) => {
    const canvas = factory();
    try {
      canvas.width = width;
      canvas.height = height;
      return { context: canvas.getContext('2d'),
        encode: spec => new Promise(resolve => canvas.toBlob(resolve, spec.mime,
          'quality' in spec ? spec.quality : undefined)),
        release() { canvas.width = 0; canvas.height = 0; } };
    } catch (error) {
      canvas.width = 0;
      canvas.height = 0;
      throw error;
    }
  };
}

const SNIFF_BYTES = 65_536;
const nativeAdapters: ImageAdapters = { decode: decodeNativeImage, canvas: createOffscreenImageCanvas };
const failed = (code: ImageErrorCode): ImageResult<never> => ({ ok: false, code });
// Only an explicitly identified memory failure is classified as such.
const memoryFailure = (error: unknown) => error instanceof ImageMemoryError;

export async function convertImage(input: Blob, format: ImageOutputFormat,
  adapters: ImageAdapters = nativeAdapters): Promise<ImageResult<Blob>> {
  let image: DecodedImage | undefined;
  let canvas: ImageCanvas | undefined;
  let stage: ImageErrorCode = 'decode-failed';
  const interrupted = () => adapters.interrupted?.() === true;
  const notify = (stage: ImageStage) => {
    if (!interrupted()) {
      try { adapters.onStage?.(stage); } catch { /* Observers must not affect conversion. */ }
    }
  };
  try {
    if (interrupted()) return failed('interrupted');
    notify('reading');
    // Only the leading bytes identify the format; do not read a whole photo into memory for this.
    let bytes = new Uint8Array(await input.slice(0, SNIFF_BYTES).arrayBuffer());
    if (interrupted()) return failed('interrupted');
    let detected = sniffImageFormat(bytes);
    // A box list can run past the leading bytes; only an unrecognized larger input needs the whole file.
    if (detected === 'unknown' && input.size > SNIFF_BYTES) {
      bytes = new Uint8Array(await input.arrayBuffer());
      if (interrupted()) return failed('interrupted');
      detected = sniffImageFormat(bytes);
    }
    if (detected === 'unknown') return failed('unsupported-type');
    try {
      notify('decoding');
      image = await adapters.decode(input);
    } catch (error) {
      if (interrupted()) return failed('interrupted');
      if (memoryFailure(error)) return failed('out-of-memory');
      if (detected !== 'heic' && detected !== 'heif') return failed('decode-failed');
      if (!adapters.rescueDecode) return failed('heic-decoder-unavailable');
      const rescued = await adapters.rescueDecode(input, notify);
      if (rescued.ok) image = rescued.value;
      if (interrupted()) return failed('interrupted');
      if (!rescued.ok) return rescued;
    }
    if (interrupted()) return failed('interrupted');
    if (!image) return failed('decode-failed');
    const dimensions = checkImageDimensions(image.width, image.height);
    if (!dimensions.ok) return dimensions;
    stage = 'encode-failed';
    notify('drawing');
    canvas = adapters.canvas(image.width, image.height);
    if (!canvas.context) return failed('encode-failed');
    const spec = IMAGE_OUTPUT_SPECS[format];
    if ('background' in spec) {
      canvas.context.fillStyle = spec.background;
      canvas.context.fillRect(0, 0, image.width, image.height);
    }
    image.paint(canvas.context);
    if (interrupted()) return failed('interrupted');
    notify('encoding');
    const blob = await canvas.encode(spec);
    if (interrupted()) return failed('interrupted');
    return blob && blob.size > 0 && blob.type === spec.mime
      ? { ok: true, value: blob } : failed('encode-failed');
  } catch (error) {
    return failed(interrupted() ? 'interrupted' : memoryFailure(error) ? 'out-of-memory' : stage);
  } finally {
    // Release both resources even if an injected cleanup fails.
    try { image?.close(); } catch { /* Cleanup must not replace a result value. */ }
    try { canvas?.release(); } catch { /* Still attempt both releases. */ }
  }
}
