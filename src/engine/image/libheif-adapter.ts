import libheif, { type MainModule } from 'libheif-js/libheif-wasm/libheif.js';
import { transfer } from 'comlink';
import { checkImageDimensions } from './limits';
import { sniffImageFormat } from './sniff';
import type { ImageErrorCode, ImageResult } from './types';

export interface RgbaImage { width: number; height: number; rgba: Uint8ClampedArray }
export type NativeModule = Pick<MainModule, 'heif_context_alloc' | 'heif_context_free' |
  'heif_context_read_from_memory' | 'heif_js_context_get_primary_image_handle' |
  'heif_image_handle_is_primary_image' | 'heif_image_handle_get_width' |
  'heif_image_handle_get_height' | 'heif_image_handle_release' | 'heif_js_decode_image2' |
  'heif_image_release' | 'heif_colorspace' | 'heif_chroma' | 'heif_channel'>;
type Handle = Parameters<NativeModule['heif_image_handle_release']>[0];
type NativeImage = Parameters<NativeModule['heif_image_release']>[0];
export const failure = (code: ImageErrorCode): ImageResult<never> => ({ ok: false, code });
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const nativeHandle = (value: unknown): value is Handle =>
  record(value) && typeof value.delete === 'function';
const enumValue = (value: unknown): unknown => record(value) ? value.value : value;
function nativeError(value: unknown): ImageResult<never> | undefined {
  if (!record(value) || !('code' in value)) return;
  const code = enumValue(value.code);
  // Memory_allocation_error (6) with Security_limit_exceeded (1000) is a refused input, not exhaustion.
  const exhausted = code === 6 && enumValue(value.subcode) !== 1000;
  if (code !== 0) return failure(exhausted ? 'out-of-memory' : 'decode-failed');
}
// Only a failed explicit allocation, or libheif's structured memory error, identifies OOM.
export class HeicAllocationError extends Error {}
const allocate = (size: number) => {
  try { return new Uint8ClampedArray(size); }
  catch (error) { if (error instanceof RangeError) throw new HeicAllocationError(); throw error; }
};

export async function decodeHeic(module: NativeModule, bytes: Uint8Array,
  allocateRgba: (size: number) => Uint8ClampedArray = allocate): Promise<ImageResult<RgbaImage>> {
  let context: ReturnType<NativeModule['heif_context_alloc']> | undefined;
  let handle: Handle | undefined;
  let image: NativeImage | undefined;
  try {
    const format = sniffImageFormat(bytes);
    if (format !== 'heic' && format !== 'heif') return failure('unsupported-type');
    context = module.heif_context_alloc();
    if (!context) return failure('out-of-memory');
    const read = nativeError(module.heif_context_read_from_memory(context, bytes));
    if (read) return read;
    // This API acquires only the primary handle, irrespective of item ordering.
    const primary: unknown = module.heif_js_context_get_primary_image_handle(context);
    const primaryError = nativeError(primary);
    if (primaryError) return primaryError;
    if (!nativeHandle(primary) || 'code' in primary) return failure('decode-failed');
    handle = primary;
    if (module.heif_image_handle_is_primary_image(handle) !== 1) return failure('decode-failed');
    const width = module.heif_image_handle_get_width(handle);
    const height = module.heif_image_handle_get_height(handle);
    const dimensions = checkImageDimensions(width, height);
    if (!dimensions.ok) return dimensions;
    const decoded: unknown = await module.heif_js_decode_image2(handle,
      module.heif_colorspace.heif_colorspace_RGB, module.heif_chroma.heif_chroma_interleaved_RGBA);
    // Record ownership before validating the rest of the response.
    if (record(decoded) && nativeHandle(decoded.image)) image = decoded.image;
    const decodeError = nativeError(decoded);
    if (decodeError) return decodeError;
    if (!record(decoded) || !image || decoded.width !== width || decoded.height !== height ||
      !Array.isArray(decoded.channels)) return failure('decode-failed');
    const channels: unknown[] = decoded.channels;
    const channel = channels.find(c => record(c) &&
      enumValue(c.id) === module.heif_channel.heif_channel_interleaved.value);
    if (!record(channel) || channel.width !== width || channel.height !== height ||
      typeof channel.stride !== 'number' || !Number.isSafeInteger(channel.stride) ||
      channel.stride < width * 4 || !(channel.data instanceof Uint8Array) ||
      channel.data.length < (height - 1) * channel.stride + width * 4) return failure('decode-failed');
    const rgba = allocateRgba(width * height * 4);
    if (rgba.length !== width * height * 4) return failure('decode-failed');
    for (let row = 0; row < height; row++) {
      rgba.set(channel.data.subarray(row * channel.stride, row * channel.stride + width * 4), row * width * 4);
    }
    // libheif applies irot/imir. No metadata or native heap views cross this boundary.
    return { ok: true, value: { width, height, rgba } };
  } catch (error) {
    return failure(error instanceof HeicAllocationError ? 'out-of-memory' : 'decode-failed');
  } finally {
    try { if (image) module.heif_image_release(image); } catch { /* Continue releasing owners. */ }
    try { if (handle) module.heif_image_handle_release(handle); } catch { /* Continue releasing owners. */ }
    try { if (context) module.heif_context_free(context); } catch { /* Preserve result. */ }
  }
}

export interface HeicWorkerOptions {
  loadWasm?: () => Promise<Uint8Array>;
  initialize?: (wasmBinary: Uint8Array) => Promise<NativeModule>;
  send?: (result: ImageResult<RgbaImage>, buffers: Transferable[]) => ImageResult<RgbaImage>;
}
export async function fetchHeicWasm(origin: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const url = new URL('/vendor/libheif/libheif.wasm', origin);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid WASM origin');
  const response = await fetcher(url.href, { redirect: 'error', credentials: 'same-origin' });
  if (!response.ok || response.redirected || new URL(response.url).origin !== url.origin) {
    throw new Error('WASM unavailable');
  }
  return new Uint8Array(await response.arrayBuffer());
}
export function createHeicWorkerApi(options: HeicWorkerOptions = {}) {
  let module: NativeModule | undefined;
  let initializing: Promise<ImageResult<null>> | undefined;
  const ready = () => initializing ??= (async (): Promise<ImageResult<null>> => {
    try {
      const binary = await (options.loadWasm ?? (() => fetchHeicWasm(globalThis.location.origin)))();
      module = await (options.initialize ?? (async wasmBinary => libheif({ wasmBinary })))(binary);
      return { ok: true, value: null };
    } catch { return failure('heic-decoder-unavailable'); }
  })();
  return { ready, async decode(bytes: Uint8Array): Promise<ImageResult<RgbaImage>> {
    try {
      const format = sniffImageFormat(bytes);
      if (format !== 'heic' && format !== 'heif') return failure('unsupported-type');
      const initialized = await ready();
      if (!initialized.ok) return initialized;
      if (!module) return failure('heic-decoder-unavailable');
      const result = await decodeHeic(module, bytes);
      return (options.send ?? transfer)(result, result.ok ? [result.value.rgba.buffer] : []);
    } catch { return failure('decode-failed'); }
  } };
}
export type HeicWorkerApi = ReturnType<typeof createHeicWorkerApi>;
