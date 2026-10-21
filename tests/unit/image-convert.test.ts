import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { convertImage, createOffscreenImageCanvas, decodeNativeImage, mainThreadImageCanvas, ImageMemoryError } from '../../src/engine/image/convert';
import type { DecodedImage, ImageAdapters, ImageContext } from '../../src/engine/image/convert';
import { checkImageDimensions, MAX_IMAGE_PIXELS } from '../../src/engine/image/limits';
import { createImageWorkerApi } from '../../src/engine/image/worker-api';
import { IMAGE_OUTPUT_SPECS } from '../../src/engine/image/output';

const fixture = (name = 'alpha.png') => new Blob([readFileSync(`tests/fixtures/image/${name}`)]);
function setup(width = 32, height = 24) {
  const order: string[] = [];
  const context: ImageContext = { fillStyle: '', fillRect: vi.fn(() => order.push('fill')),
    drawImage: vi.fn(() => order.push('draw')) };
  const image: DecodedImage = { width, height, paint: ctx => ctx.drawImage(new FakeBitmap(), 0, 0), close: vi.fn() };
  const surface = { context, encode: vi.fn(async (spec: { mime: string }) => new Blob(['pixels'], { type: spec.mime })),
    release: vi.fn() };
  const adapters: ImageAdapters = { decode: vi.fn(async () => image), canvas: vi.fn(() => surface) };
  return { order, context, image, surface, adapters };
}
// Structural bitmap fake, including the browser's ownership operation.
class FakeBitmap implements ImageBitmap {
  width = 32;
  height = 24;
  close = vi.fn();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('image conversion', () => {
  it('sniffs bytes, ignores file names and MIME, re-encodes and composites before drawing', async () => {
    const s = setup();
    const file = new File([await fixture().arrayBuffer()], 'wrong.heic', { type: 'text/plain' });
    const result = await convertImage(file, 'jpg', s.adapters);
    expect(result.ok && result.value.type).toBe('image/jpeg');
    expect(s.order).toEqual(['fill', 'draw']);
    expect(s.context.fillStyle).toBe('#ffffff');
    expect(s.context.fillRect).toHaveBeenCalledWith(0, 0, 32, 24);
    expect(s.surface.encode).toHaveBeenCalledWith(IMAGE_OUTPUT_SPECS.jpg);
    expect(s.image.close).toHaveBeenCalledOnce();
    expect(s.surface.release).toHaveBeenCalledOnce();
    expect(result.ok && result.value).not.toBe(file);
  });
  it('keeps alpha for PNG and reads complete boxes rather than a fixed prefix', async () => {
    const s = setup();
    await convertImage(fixture('sample.heic'), 'png', s.adapters);
    expect(s.order).toEqual(['draw']);
    expect(s.surface.encode).toHaveBeenCalledWith(IMAGE_OUTPUT_SPECS.png);
  });
  it.each(['alpha.png', 'oriented.jpg', 'alpha.webp', 'animated.gif', 'sample.bmp', 'sample.ico', 'sample.avif', 'sample.heic'])(
    'recognizes the complete %s input', async name => {
      const s = setup();
      expect((await convertImage(fixture(name), 'png', s.adapters)).ok).toBe(true);
    });
  it('returns unsupported-type without decoding unknown input', async () => {
    const s = setup();
    expect(await convertImage(new Blob(['unknown'], { type: 'image/png' }), 'png', s.adapters))
      .toEqual({ ok: false, code: 'unsupported-type' });
    expect(s.adapters.decode).not.toHaveBeenCalled();
  });
  it('converts read failures to values', async () => {
    const input = fixture();
    vi.spyOn(input, 'slice').mockReturnValue({ arrayBuffer: async () => { throw new Error('read'); } } as unknown as Blob);
    expect(await convertImage(input, 'png', setup().adapters)).toEqual({ ok: false, code: 'decode-failed' });
  });
  it.each([[4096, 4096, null], [4097, 4096, 'too-large'], [4032, 3024, null],
    [0, 24, 'decode-failed'], [-1, 24, 'decode-failed'], [1.5, 24, 'decode-failed'],
    [32, NaN, 'decode-failed'], [Infinity, 24, 'decode-failed'], [32, 0, 'decode-failed']])(
    'checks dimensions %s × %s before canvas allocation', async (width, height, code) => {
      expect(MAX_IMAGE_PIXELS).toBe(16_777_216);
      const s = setup(width, height);
      const result = await convertImage(fixture(), 'png', s.adapters);
      expect(result.ok ? null : result.code).toBe(code);
      expect(s.adapters.canvas).toHaveBeenCalledTimes(code ? 0 : 1);
      expect(s.image.close).toHaveBeenCalledOnce();
      expect(checkImageDimensions(width, height).ok).toBe(code === null);
    });
  it.each(['oriented.jpg', 'sample.avif', 'sample.heic'])(
    'routes decode failures for %s and never rescues AVIF', async name => {
      const s = setup();
      s.adapters.decode = vi.fn().mockRejectedValue(new Error('decode'));
      expect(await convertImage(fixture(name), 'png', s.adapters)).toEqual({ ok: false,
        code: name.endsWith('heic') ? 'heic-decoder-unavailable' : 'decode-failed' });
      s.adapters.rescueDecode = vi.fn<NonNullable<ImageAdapters['rescueDecode']>>(async () => ({ ok: true, value: s.image }));
      const result = await convertImage(fixture(name), 'png', s.adapters);
      expect(result.ok).toBe(name.endsWith('heic'));
      expect(s.adapters.rescueDecode).toHaveBeenCalledTimes(name.endsWith('heic') ? 1 : 0);
    });
  it.each(['heic', 'heif'] as const)('rescues %s, preserving failure values and closing rescued images', async brand => {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setUint32(0, 16);
    bytes.set(new TextEncoder().encode(`ftyp${brand === 'heic' ? 'heic' : 'mif1'}`), 4);
    const s = setup();
    s.adapters.decode = vi.fn().mockRejectedValue(new Error('decode'));
    s.adapters.rescueDecode = vi.fn<NonNullable<ImageAdapters['rescueDecode']>>(async () => ({ ok: false, code: 'too-large' }));
    expect(await convertImage(new Blob([bytes]), 'png', s.adapters)).toEqual({ ok: false, code: 'too-large' });
    s.adapters.rescueDecode = vi.fn<NonNullable<ImageAdapters['rescueDecode']>>(async () => ({ ok: true, value: s.image }));
    expect((await convertImage(new Blob([bytes]), 'png', s.adapters)).ok).toBe(true);
    expect(s.image.close).toHaveBeenCalledOnce();
  });
  it('does not infer memory exhaustion from arbitrary errors or quota errors', async () => {
    const s = setup();
    for (const error of [new Error('out of memory'), new DOMException('quota', 'QuotaExceededError')]) {
      s.adapters.decode = async () => { throw error; };
      expect(await convertImage(fixture(), 'png', s.adapters)).toEqual({ ok: false, code: 'decode-failed' });
    }
  });
  it('does not rescue excessive dimensions or an explicitly identified memory failure', async () => {
    const s = setup(4097, 4096);
    s.adapters.rescueDecode = vi.fn();
    expect(await convertImage(fixture('sample.heic'), 'png', s.adapters)).toEqual({ ok: false, code: 'too-large' });
    s.adapters.decode = vi.fn().mockRejectedValue(new ImageMemoryError('memory'));
    expect(await convertImage(fixture('sample.heic'), 'png', s.adapters)).toEqual({ ok: false, code: 'out-of-memory' });
    expect(s.adapters.rescueDecode).not.toHaveBeenCalled();
  });
  it.each(['context', 'canvas', 'draw', 'null', 'empty', 'mime', 'throw', 'memory'])(
    'returns a failure value and releases resources for %s', async failure => {
      const s = setup();
      if (failure === 'context') s.adapters.canvas = () => ({ ...s.surface, context: null });
      if (failure === 'canvas') s.adapters.canvas = () => { throw new Error('allocation'); };
      if (failure === 'draw') s.image.paint = () => { throw new Error('draw'); };
      if (failure === 'null') s.adapters.canvas = () => ({ ...s.surface, encode: async () => null });
      if (failure === 'empty') s.surface.encode.mockResolvedValue(new Blob([], { type: 'image/png' }));
      if (failure === 'mime') s.surface.encode.mockResolvedValue(new Blob(['x'], { type: 'image/webp' }));
      if (failure === 'throw') s.surface.encode.mockRejectedValue(new Error('encode'));
      if (failure === 'memory') s.surface.encode.mockRejectedValue(new ImageMemoryError('memory'));
      expect(await convertImage(fixture(), 'png', s.adapters)).toEqual({ ok: false,
        code: failure === 'memory' ? 'out-of-memory' : 'encode-failed' });
      expect(s.image.close).toHaveBeenCalledOnce();
      expect(s.surface.release).toHaveBeenCalledTimes(failure === 'canvas' ? 0 : 1);
    });
  it('keeps result values even when cleanup throws and still releases the canvas', async () => {
    const s = setup();
    s.image.close = () => { throw new Error('close'); };
    expect((await convertImage(fixture(), 'png', s.adapters)).ok).toBe(true);
    expect(s.surface.release).toHaveBeenCalledOnce();
  });
  it.each(['before', 'read', 'decode', 'rescue', 'encode', 'reject'])(
    'converges interruption during %s and releases late resources', async phase => {
      const s = setup();
      let interrupted = phase === 'before';
      s.adapters.interrupted = () => interrupted;
      const input = fixture(phase === 'rescue' ? 'sample.heic' : 'alpha.png');
      if (phase === 'read') vi.spyOn(input, 'slice').mockReturnValue({ arrayBuffer: async () => {
        interrupted = true; return new ArrayBuffer(0);
      } } as unknown as Blob);
      if (phase === 'decode') s.adapters.decode = async () => { interrupted = true; return s.image; };
      if (phase === 'rescue') {
        s.adapters.decode = async () => { throw new Error('decode'); };
        s.adapters.rescueDecode = async () => { interrupted = true; return { ok: true, value: s.image }; };
      }
      if (phase === 'encode' || phase === 'reject') s.surface.encode.mockImplementation(async () => {
        interrupted = true;
        if (phase === 'reject') throw new Error('encode');
        return new Blob(['late'], { type: 'image/png' });
      });
      expect(await convertImage(input, 'png', s.adapters)).toEqual({ ok: false, code: 'interrupted' });
      expect(s.image.close).toHaveBeenCalledTimes(['before', 'read'].includes(phase) ? 0 : 1);
      expect(s.surface.release).toHaveBeenCalledTimes(['encode', 'reject'].includes(phase) ? 1 : 0);
    });
});

describe('native adapters', () => {
  it('uses orientation exactly once and closes the bitmap', async () => {
    const bitmap = new FakeBitmap();
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', decode);
    try {
      const input = fixture();
      const image = await decodeNativeImage(input);
      const s = setup();
      image.paint(s.context);
      image.close();
      expect(decode).toHaveBeenCalledWith(input, { imageOrientation: 'from-image' });
      expect(s.context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(bitmap.close).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses convertToBlob and releases backing storage', async () => {
    const s = setup();
    class Canvas {
      constructor(public width: number, public height: number) {}
      getContext = () => s.context;
      convertToBlob = vi.fn(async () => new Blob(['x']));
    }
    const allocations: Canvas[] = [];
    vi.stubGlobal('OffscreenCanvas', class extends Canvas {
      constructor(width: number, height: number) { super(width, height); allocations.push(this); }
    });
    try {
      const canvas = createOffscreenImageCanvas(32, 24);
      await canvas.encode(IMAGE_OUTPUT_SPECS.jpg);
      expect(allocations[0]?.convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.92 });
      canvas.release();
      expect(allocations[0]?.width).toBe(0);
      expect(allocations[0]?.height).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['jpg', 'png'] as const)('promisifies DOM canvas %s output and releases its backing store', async format => {
    const context = setup().context;
    const toBlob = vi.fn((callback: BlobCallback, mime?: string, _quality?: number) =>
      callback(new Blob(['x'], { type: mime })));
    const element = { width: 0, height: 0, getContext: () => context, toBlob };
    const surface = mainThreadImageCanvas(() => element)(32, 24);
    expect([element.width, element.height]).toEqual([32, 24]);
    const spec = IMAGE_OUTPUT_SPECS[format];
    expect((await surface.encode(spec))?.type).toBe(spec.mime);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), spec.mime, format === 'jpg' ? 0.92 : undefined);
    surface.release();
    expect([element.width, element.height]).toEqual([0, 0]);
  });
  it('returns null from toBlob and turns synchronous exceptions into rejected promises', async () => {
    const element = { width: 0, height: 0, getContext: () => null,
      toBlob: vi.fn((callback: BlobCallback) => callback(null)) };
    const surface = mainThreadImageCanvas(() => element)(32, 24);
    expect(await surface.encode(IMAGE_OUTPUT_SPECS.png)).toBeNull();
    element.toBlob.mockImplementation(() => { throw new Error('encode'); });
    await expect(surface.encode(IMAGE_OUTPUT_SPECS.png)).rejects.toThrow('encode');
    surface.release();
  });
  it('releases a DOM backing store if context acquisition throws', () => {
    const element = { width: 0, height: 0, getContext: () => { throw new Error('context'); },
      toBlob: vi.fn() };
    expect(() => mainThreadImageCanvas(() => element)(32, 24)).toThrow('context');
    expect([element.width, element.height]).toEqual([0, 0]);
  });

});

describe('format detection beyond the leading bytes', () => {
  it('still recognizes an ISOBMFF file whose ftyp box follows a 64 KiB box', async () => {
    const free = new Uint8Array(65_536);
    new DataView(free.buffer).setUint32(0, free.length);
    free.set([102, 114, 101, 101], 4);
    const ftyp = new Uint8Array(24);
    new DataView(ftyp.buffer).setUint32(0, 24);
    ftyp.set([102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 109, 105, 102, 49, 104, 101, 105, 99], 4);
    const s = setup();
    s.adapters.decode = vi.fn(async () => { throw new Error('native'); });
    const result = await convertImage(new Blob([free, ftyp]), 'png', s.adapters);
    expect(result).toEqual({ ok: false, code: 'heic-decoder-unavailable' });
  });
});

describe('image worker API', () => {
  it('targets interruption, rejects reused and concurrent IDs, and closes a late bitmap', async () => {
    const s = setup();
    const pending = deferred<DecodedImage>();
    s.adapters.decode = vi.fn(() => pending.promise);
    const api = createImageWorkerApi(s.adapters);
    api.interrupt({ type: 'interrupt', requestId: 1 });
    const request = { type: 'convert', requestId: 1, input: fixture(), format: 'png' } as const;
    const result = api.convert(request);
    await vi.waitFor(() => expect(s.adapters.decode).toHaveBeenCalledOnce());
    api.interrupt({ type: 'interrupt', requestId: 99 });
    expect((await api.convert({ ...request, requestId: 2 })).result).toEqual({ ok: false, code: 'interrupted' });
    api.interrupt({ type: 'interrupt', requestId: 1 });
    pending.resolve(s.image);
    expect(await result).toEqual({ type: 'result', requestId: 1, result: { ok: false, code: 'interrupted' } });
    expect(s.image.close).toHaveBeenCalledOnce();
    api.interrupt({ type: 'interrupt', requestId: 1 });
    expect((await api.convert(request)).result).toEqual({ ok: false, code: 'interrupted' });
    expect(await api.convert({ ...request, requestId: 3 })).toMatchObject({ type: 'result', requestId: 3, result: { ok: true } });
    expect((await api.convert({ ...request, requestId: NaN })).result.ok).toBe(false);
  });
  it('ignores an unknown interrupt while a request succeeds', async () => {
    const api = createImageWorkerApi(setup().adapters);
    const result = api.convert({ type: 'convert', requestId: 0, input: fixture(), format: 'png' });
    api.interrupt({ type: 'interrupt', requestId: 4 });
    expect((await result).result.ok).toBe(true);
  });
});
