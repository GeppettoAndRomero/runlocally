import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { HeicWorkerManager, createHeicConnection, type HeicConnection } from '../../src/engine/image/heic-client';
import { convertImage, ImageMemoryError, type DecodedImage } from '../../src/engine/image/convert';
import type { RgbaImage } from '../../src/engine/image/libheif-adapter';
import type { ImageResult } from '../../src/engine/image/types';

const input = new Blob([readFileSync('tests/fixtures/image/sample.heic')]);
const avif = new Blob([readFileSync('tests/fixtures/image/sample.avif')]);
const pixels: RgbaImage = { width: 2, height: 1, rgba: new Uint8ClampedArray(8) };
const success: ImageResult<RgbaImage> = { ok: true, value: pixels };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
function setup() {
  let pagehide: (() => void) | undefined, fault: (() => void) | undefined;
  const unsubscribe = vi.fn(), unsubscribePage = vi.fn();
  const connection = {
    ready: vi.fn(async (): Promise<ImageResult<null>> => ({ ok: true, value: null })),
    decode: vi.fn(async (): Promise<ImageResult<RgbaImage>> => success),
    subscribeFailure: vi.fn((listener: () => void) => { fault = listener; return unsubscribe; }),
    release: vi.fn(), terminate: vi.fn(),
  } satisfies HeicConnection;
  const factory = vi.fn(() => connection);
  const image = { width: 2, height: 1, paint: vi.fn(), close: vi.fn() };
  const toImage = vi.fn(async (): Promise<DecodedImage> => image);
  const manager = new HeicWorkerManager({ factory, toImage,
    subscribePagehide: listener => { pagehide = listener; return unsubscribePage; } });
  return { manager, connection, factory, image, toImage, unsubscribe, unsubscribePage,
    pagehide: () => pagehide?.(), fault: () => fault?.() };
}

describe('HEIC rescue client', () => {
  it('is lazy, rejects AVIF without a worker and reclaims idle connections before regenerating', async () => {
    const s = setup();
    expect(s.factory).not.toHaveBeenCalled();
    expect(await s.manager.rescueDecode(avif)).toEqual({ ok: false, code: 'unsupported-type' });
    expect(s.factory).not.toHaveBeenCalled();
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: true, value: s.image });
    expect(s.connection.terminate).toHaveBeenCalledTimes(1);
    expect(s.connection.release).toHaveBeenCalledTimes(1);
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: true, value: s.image });
    expect(s.factory).toHaveBeenCalledTimes(2);
    expect(s.connection.terminate).toHaveBeenCalledTimes(2);
  });
  it('serializes pending jobs and terminates only after both queue and execution are empty', async () => {
    const s = setup(), first = deferred<ImageResult<RgbaImage>>();
    s.connection.decode.mockImplementationOnce(() => first.promise);
    const a = s.manager.rescueDecode(input), b = s.manager.rescueDecode(input);
    await tick();
    expect(s.connection.decode).toHaveBeenCalledTimes(1);
    expect(s.connection.terminate).not.toHaveBeenCalled();
    first.resolve(success);
    expect((await a).ok).toBe(true); expect((await b).ok).toBe(true);
    expect(s.connection.decode).toHaveBeenCalledTimes(2);
    expect(s.factory).toHaveBeenCalledTimes(1);
    expect(s.connection.terminate).toHaveBeenCalledOnce();
  });
  it.each(['pagehide', 'explicit'])(
    'interrupts active and queued requests once on %s and ignores late replies', async mode => {
      const s = setup(), pending = deferred<ImageResult<RgbaImage>>();
      s.connection.decode.mockImplementation(() => pending.promise);
      const a = s.manager.rescueDecode(input), b = s.manager.rescueDecode(input);
      await tick();
      if (mode === 'pagehide') s.pagehide(); else s.manager.terminate();
      s.manager.terminate(); s.pagehide();
      expect(await a).toEqual({ ok: false, code: 'interrupted' });
      expect(await b).toEqual({ ok: false, code: 'interrupted' });
      pending.resolve(success); await tick();
      expect(s.toImage).not.toHaveBeenCalled();
      expect(s.connection.terminate).toHaveBeenCalledOnce();
      expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: 'interrupted' });
    });
  it('closes a bitmap arriving after termination', async () => {
    const s = setup(), bitmap = deferred<DecodedImage>();
    s.toImage.mockImplementationOnce(() => bitmap.promise);
    const result = s.manager.rescueDecode(input); await tick();
    expect(s.toImage).toHaveBeenCalledOnce();
    s.manager.terminate(); bitmap.resolve(s.image); await tick();
    expect(await result).toEqual({ ok: false, code: 'interrupted' });
    expect(s.image.close).toHaveBeenCalledOnce();
  });
  it.each(['startup', 'decode'])(
    'completes every request on worker faults during %s without assuming OOM', async stage => {
      const s = setup();
      if (stage === 'startup') s.connection.ready.mockImplementation(() => deferred<ImageResult<null>>().promise);
      else s.connection.decode.mockImplementation(() => deferred<ImageResult<RgbaImage>>().promise);
      const a = s.manager.rescueDecode(input), b = s.manager.rescueDecode(input); await tick();
      s.fault();
      const expected = { ok: false, code: stage === 'startup' ? 'heic-decoder-unavailable' : 'decode-failed' };
      expect(await a).toEqual(expected); expect(await b).toEqual(expected);
      expect(s.connection.terminate).toHaveBeenCalledOnce();
      s.connection.ready.mockResolvedValue({ ok: true, value: null }); s.connection.decode.mockResolvedValue(success);
      expect((await s.manager.rescueDecode(input)).ok).toBe(true);
    });
  it('reports factory failure and unavailable startup as values', async () => {
    const s = setup();
    s.factory.mockImplementationOnce(() => { throw new Error('Worker disabled'); });
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: 'heic-decoder-unavailable' });
    s.connection.ready.mockResolvedValueOnce({ ok: false, code: 'heic-decoder-unavailable' });
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: 'heic-decoder-unavailable' });
    expect(s.connection.decode).not.toHaveBeenCalled();
  });
  it('contains proxy and bitmap failures, validates responses and still cleans up', async () => {
    const s = setup();
    s.connection.decode.mockRejectedValueOnce(new Error('postMessage'));
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: 'decode-failed' });
    for (const value of [{ ...pixels, width: 16777217 }, { ...pixels, width: 0 },
      { ...pixels, rgba: new Uint8ClampedArray(1) }]) {
      s.connection.decode.mockResolvedValueOnce({ ok: true, value });
      expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: value.width > 16777216 ? 'too-large' : 'decode-failed' });
    }
    s.toImage.mockRejectedValueOnce(new Error('bitmap'));
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: 'decode-failed' });
    s.toImage.mockResolvedValueOnce({ ...s.image, width: 3 });
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: 'decode-failed' });
    expect(s.image.close).toHaveBeenCalledOnce();
    s.connection.release.mockImplementationOnce(() => { throw new Error('closed'); });
    expect((await s.manager.rescueDecode(input)).ok).toBe(true);
    expect(s.connection.terminate).toHaveBeenCalledTimes(7);
  });
  it('plugs into the existing converter, painting once without reorientation and closing the image', async () => {
    const s = setup(), context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }, release = vi.fn();
    const result = await convertImage(input, 'jpg', {
      decode: async () => { throw new Error('native unsupported'); }, rescueDecode: s.manager.rescueDecode,
      canvas: (width, height) => {
        expect([width, height]).toEqual([2, 1]);
        return { context, encode: async () => new Blob(['encoded'], { type: 'image/jpeg' }), release };
      },
    });
    expect(result.ok).toBe(true);
    expect(s.image.paint).toHaveBeenCalledWith(context);
    expect(s.image.close).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
  it('handles synchronous event subscription and stale worker errors safely', async () => {
    const unsubscribe = vi.fn(), factory = vi.fn();
    const stopped = new HeicWorkerManager({ factory,
      subscribePagehide(listener) { listener(); return unsubscribe; } });
    expect(await stopped.rescueDecode(input)).toEqual({ ok: false, code: 'interrupted' });
    expect(factory).not.toHaveBeenCalled(); expect(unsubscribe).toHaveBeenCalledOnce();
    const s = setup();
    let stale: (() => void) | undefined;
    s.connection.subscribeFailure.mockImplementationOnce(listener => { stale = listener; return vi.fn(); });
    await s.manager.rescueDecode(input);
    const pending = deferred<ImageResult<RgbaImage>>();
    // A new factory invocation represents a distinct endpoint even when using the same fake methods.
    s.factory.mockImplementationOnce(() => ({ ...s.connection }));
    s.connection.decode.mockImplementationOnce(() => pending.promise);
    const result = s.manager.rescueDecode(input); await tick();
    stale?.(); pending.resolve(success);
    expect((await result).ok).toBe(true);
    const faulted = setup();
    const detach = vi.fn();
    faulted.connection.subscribeFailure.mockImplementationOnce(listener => { listener(); return detach; });
    expect(await faulted.manager.rescueDecode(input)).toEqual({ ok: false, code: 'heic-decoder-unavailable' });
    expect(detach).toHaveBeenCalledOnce();
  });
  it('constructs a bitmap for the drawImage contract and reports explicit allocation failure', async () => {
    const s = setup();
    const bitmap = { width: 2, height: 1, close: vi.fn() };
    const createBitmap = vi.fn(async () => bitmap);
    const imageData = vi.fn(function (data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height };
    });
    vi.stubGlobal('ImageData', imageData); vi.stubGlobal('createImageBitmap', createBitmap);
    try {
      const manager = new HeicWorkerManager({ factory: s.factory });
      const result = await manager.rescueDecode(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
      result.value.paint(context); result.value.close();
      expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(bitmap.close).toHaveBeenCalledOnce();
      expect(imageData).toHaveBeenCalledWith(pixels.rgba, 2, 1);
      expect(imageData.mock.calls[0][0]).not.toBe(pixels.rgba);
    } finally { vi.unstubAllGlobals(); }
    s.toImage.mockRejectedValueOnce(new ImageMemoryError());
    expect(await s.manager.rescueDecode(input)).toEqual({ ok: false, code: 'out-of-memory' });
  });
  it('uses module Workers, subscribes to both fault events and removes both', () => {
    const worker = { postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), terminate: vi.fn() };
    const constructor = vi.fn(function () { return worker; });
    vi.stubGlobal('Worker', constructor);
    try {
      const connection = createHeicConnection(), listener = vi.fn();
      const unsubscribe = connection.subscribeFailure(listener);
      expect(constructor).toHaveBeenCalledWith(expect.any(URL), { type: 'module' });
      expect(worker.addEventListener.mock.calls).toEqual([['message', expect.any(Function)], ['error', listener], ['messageerror', listener]]);
      unsubscribe(); connection.release(); connection.terminate();
      expect(worker.removeEventListener.mock.calls).toEqual([['error', listener], ['messageerror', listener], ['message', expect.any(Function)]]);
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
