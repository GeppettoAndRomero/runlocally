import { wrap, releaseProxy, type Endpoint } from 'comlink';
import { ImageMemoryError, type DecodedImage, type ImageAdapters } from './convert';
import { checkImageDimensions } from './limits';
import { sniffImageFormat } from './sniff';
import type { ImageErrorCode, ImageResult } from './types';
import type { HeicWorkerApi, RgbaImage } from './libheif-adapter';

const failed = (code: ImageErrorCode): ImageResult<never> => ({ ok: false, code });
export interface HeicConnection {
  ready(): Promise<ImageResult<null>>;
  decode(bytes: Uint8Array): Promise<ImageResult<RgbaImage>>;
  subscribeFailure(listener: () => void): () => void;
  release(): void;
  terminate(): void;
}
export function createHeicConnection(): HeicConnection {
  const worker = new Worker(new URL('./heic-worker.ts', import.meta.url), { type: 'module' });
  const listeners = new Set<EventListenerOrEventListenerObject>();
  let releasing = false;
  const endpoint: Endpoint = {
    postMessage(message: unknown, transfers?: Transferable[]) {
      // releaseProxy clears its pending map; the immediately terminated worker needs no handshake.
      if (!releasing) worker.postMessage(message, transfers ?? []);
    },
    addEventListener(type, listener) { listeners.add(listener); worker.addEventListener(type, listener); },
    removeEventListener(type, listener) { listeners.delete(listener); worker.removeEventListener(type, listener); },
  };
  const proxy = wrap<HeicWorkerApi>(endpoint);
  return { ready: () => proxy.ready(), decode: bytes => proxy.decode(bytes),
    subscribeFailure(listener) {
      worker.addEventListener('error', listener);
      worker.addEventListener('messageerror', listener);
      return () => {
        worker.removeEventListener('error', listener);
        worker.removeEventListener('messageerror', listener);
      };
    },
    release() {
      if (releasing) return;
      releasing = true;
      try { proxy[releaseProxy](); }
      finally {
        for (const listener of listeners) worker.removeEventListener('message', listener);
        listeners.clear();
      }
    }, terminate: () => worker.terminate() };
}
async function bitmapImage(value: RgbaImage): Promise<DecodedImage> {
  let data: Uint8ClampedArray<ArrayBuffer>;
  try { data = new Uint8ClampedArray(value.rgba); }
  catch (error) { if (error instanceof RangeError) throw new ImageMemoryError(); throw error; }
  const bitmap = await createImageBitmap(new ImageData(data, value.width, value.height));
  return { width: bitmap.width, height: bitmap.height,
    paint: context => context.drawImage(bitmap, 0, 0), close: () => bitmap.close() };
}
interface Job { input: Blob; finish: (result: ImageResult<DecodedImage>) => void }
export interface HeicManagerOptions {
  factory?: () => HeicConnection;
  subscribePagehide?: (listener: () => void) => () => void;
  toImage?: (value: RgbaImage) => Promise<DecodedImage>;
}
export class HeicWorkerManager {
  private queue: Job[] = [];
  private active?: Job;
  private connection?: HeicConnection;
  private unsubscribeFailure?: () => void;
  private unsubscribePagehide?: () => void;
  private stopped = false;
  private stage: ImageErrorCode = 'heic-decoder-unavailable';
  constructor(private readonly options: HeicManagerOptions = {}) {}

  readonly rescueDecode: NonNullable<ImageAdapters['rescueDecode']> = input => {
    if (this.stopped) return Promise.resolve(failed('interrupted'));
    return new Promise(resolve => {
      this.queue.push({ input, finish: resolve });
      if (!this.active) void this.drain();
    });
  };
  terminate(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.finishAll('interrupted');
  }
  private cleanup(): void {
    const connection = this.connection;
    this.connection = undefined;
    for (const release of [this.unsubscribeFailure, this.unsubscribePagehide,
      connection && (() => connection.release()), connection && (() => connection.terminate())]) {
      try { release?.(); } catch { /* Attempt every cleanup even for a closed endpoint. */ }
    }
    this.unsubscribeFailure = this.unsubscribePagehide = undefined;
  }
  private finishAll(code: ImageErrorCode): void {
    this.active?.finish(failed(code));
    this.active = undefined;
    for (const job of this.queue.splice(0)) job.finish(failed(code));
    this.cleanup();
  }
  private async drain(): Promise<void> {
    const job = this.queue.shift();
    if (!job || this.stopped) return;
    this.active = job;
    this.stage = 'decode-failed';
    let image: DecodedImage | undefined;
    try {
      this.unsubscribePagehide ??= this.options.subscribePagehide?.(() => this.terminate());
      if (this.active !== job) { this.cleanup(); return; }
      const bytes = new Uint8Array(await job.input.arrayBuffer());
      if (this.active !== job) return;
      const format = sniffImageFormat(bytes);
      if (format !== 'heic' && format !== 'heif') { job.finish(failed('unsupported-type')); return; }
      if (!this.connection) {
        this.stage = 'heic-decoder-unavailable';
        this.connection = (this.options.factory ?? createHeicConnection)();
        const connection = this.connection;
        this.unsubscribeFailure = connection.subscribeFailure(() => {
          if (this.connection === connection) this.finishAll(this.stage);
        });
        if (this.active !== job) { this.cleanup(); return; }
        const ready = await connection.ready();
        if (this.active !== job) return;
        if (!ready.ok) { this.cleanup(); job.finish(ready); return; }
      }
      this.stage = 'decode-failed';
      const result = await this.connection.decode(bytes);
      if (this.active !== job) return;
      if (!result.ok) { job.finish(result); return; }
      const { width, height, rgba } = result.value;
      const dimensions = checkImageDimensions(width, height);
      if (!dimensions.ok) { job.finish(dimensions); return; }
      if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) {
        job.finish(failed('decode-failed')); return;
      }
      image = await (this.options.toImage ?? bitmapImage)(result.value);
      if (this.active !== job) return;
      if (image.width !== width || image.height !== height) { job.finish(failed('decode-failed')); return; }
      job.finish({ ok: true, value: image });
      image = undefined; // Ownership passes to convertImage, which calls close().
    } catch (error) {
      if (this.active === job) {
        if (this.stage === 'heic-decoder-unavailable') this.cleanup();
        job.finish(failed(error instanceof ImageMemoryError ? 'out-of-memory' : this.stage));
      }
    }
    finally {
      try { image?.close(); } catch { /* Late bitmap still needs an attempted close. */ }
      if (this.active === job) {
        this.active = undefined;
        if (this.queue.length) void this.drain();
        else this.cleanup();
      }
    }
  }
}
