import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import libheif from 'libheif-js/libheif-wasm/libheif.js';
import { createHeicWorkerApi, decodeHeic, fetchHeicWasm, HeicAllocationError,
  type NativeModule } from '../../src/engine/image/libheif-adapter';
import { MAX_IMAGE_PIXELS } from '../../src/engine/image/limits';

const heic = new Uint8Array(readFileSync('tests/fixtures/image/sample.heic'));
const avif = new Uint8Array(readFileSync('tests/fixtures/image/sample.avif'));
const binary = () => Promise.resolve(new Uint8Array(readFileSync('node_modules/libheif-js/libheif-wasm/libheif.wasm')));
const realModule = async () => libheif({ wasmBinary: await binary() });
// Derive a real HEVC file without encoding. Add imir after irot, fixing all parent sizes,
// the association count and the absolute iloc extent. Keep the compressed pixels unchanged.
function oriented(mirror: boolean): Uint8Array {
  const bytes = Buffer.from(heic);
  expect(bytes.toString('ascii', 237, 241)).toBe('irot');
  bytes[241] = 1; // 90 degrees counterclockwise
  if (!mirror) return bytes;
  const imir = Buffer.from([0, 0, 0, 9, 105, 109, 105, 114, 0]); // reflection across the horizontal axis
  bytes.writeUInt32BE(bytes.readUInt32BE(36) + 10, 36);
  bytes.writeUInt32BE(bytes.readUInt32BE(166) + 10, 166);
  bytes.writeUInt32BE(bytes.readUInt32BE(174) + 9, 174);
  bytes.writeUInt32BE(bytes.readUInt32BE(369) + 1, 369);
  bytes[387] = 7;
  bytes.writeUInt32BE(bytes.readUInt32BE(416) + 10, 416);
  return Buffer.concat([bytes.subarray(0, 369), imir, bytes.subarray(369, 394),
    Buffer.from([0x87]), bytes.subarray(394)]);
}
function fake() {
  const context = { delete() {} }, primary = { itemId: 2, delete() {} }, image = { delete() {} };
  const module = {
    heif_context_alloc: vi.fn(() => context), heif_context_free: vi.fn(),
    heif_context_read_from_memory: vi.fn(() => ({ code: { value: 0 as const }, subcode: { value: 0 as const }, message: 'Success' })),
    heif_js_context_get_primary_image_handle: vi.fn((): unknown => primary),
    heif_image_handle_is_primary_image: vi.fn(() => 1),
    heif_image_handle_get_width: vi.fn(() => 2), heif_image_handle_get_height: vi.fn(() => 1),
    heif_image_handle_release: vi.fn(), heif_image_release: vi.fn(),
    heif_js_decode_image2: vi.fn((): unknown => ({ image, width: 2, height: 1,
      channels: [{ id: { value: 10 }, width: 2, height: 1, stride: 12,
        data: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 99, 99, 99, 99]) }] })),
    heif_colorspace: { heif_colorspace_RGB: { value: 1 } },
    heif_chroma: { heif_chroma_interleaved_RGBA: { value: 11 } },
    heif_channel: { heif_channel_interleaved: { value: 10 } },
  };
  // The fixture above supplies only the enum members used by the decoder. Obtain the
  // complete enum tables from the pinned runtime rather than inventing an alternate API.
  return { module, context, primary, image };
}
async function mockModule() {
  const native = await realModule();
  const f = fake();
  const module = { ...f.module, heif_colorspace: native.heif_colorspace,
    heif_chroma: native.heif_chroma, heif_channel: native.heif_channel } satisfies NativeModule;
  return { ...f, module };
}

describe('pinned libheif', () => {
  it('decodes actual HEVC pixels and applies irot and imir exactly once', async () => {
    const module = await realModule();
    const base = await decodeHeic(module, heic);
    expect(base.ok).toBe(true);
    if (!base.ok) throw new Error(base.code);
    expect([base.value.width, base.value.height, base.value.rgba.length]).toEqual([240, 240, 230400]);
    expect(Array.from(base.value.rgba.slice(0, 4))).toEqual([1, 1, 3, 255]);
    for (const mirror of [false, true]) {
      const result = await decodeHeic(module, oriented(mirror));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      expect([result.value.width, result.value.height]).toEqual([240, 240]);
      for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) {
        const sourceX = mirror ? y : 239 - y, sourceY = x;
        expect(result.value.rgba.subarray((y * 240 + x) * 4, (y * 240 + x + 1) * 4))
          .toEqual(base.value.rgba.subarray((sourceY * 240 + sourceX) * 4, (sourceY * 240 + sourceX + 1) * 4));
      }
    }
    // The independent RGBA copy survives later native allocations/releases.
    expect(base.value.rgba.slice(0, 4)).toEqual(new Uint8ClampedArray([1, 1, 3, 255]));
  });
  it('gets the primary directly, copies padded rows and releases every acquired owner', async () => {
    const { module, context, primary, image } = await mockModule();
    const result = await decodeHeic(module, heic);
    expect(result).toEqual({ ok: true, value: { width: 2, height: 1,
      rgba: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) } });
    expect(module.heif_js_decode_image2).toHaveBeenCalledWith(primary, module.heif_colorspace.heif_colorspace_RGB,
      module.heif_chroma.heif_chroma_interleaved_RGBA);
    expect(module.heif_image_release).toHaveBeenCalledWith(image);
    expect(module.heif_image_handle_release).toHaveBeenCalledWith(primary);
    expect(module.heif_context_free).toHaveBeenCalledWith(context);
  });
  it.each(['primary', 'flag', 'large', 'invalid', 'decode', 'oom', 'allocation', 'runtime', 'channels'])(
    'cleans up on %s failure', async kind => {
      const { module, primary } = await mockModule();
      let code = 'decode-failed';
      if (kind === 'primary') module.heif_js_context_get_primary_image_handle.mockReturnValue({ code: { value: 2 } });
      if (kind === 'flag') module.heif_image_handle_is_primary_image.mockReturnValue(0);
      if (kind === 'large') { module.heif_image_handle_get_width.mockReturnValue(MAX_IMAGE_PIXELS + 1); code = 'too-large'; }
      if (kind === 'invalid') module.heif_image_handle_get_width.mockReturnValue(NaN);
      if (kind === 'decode' || kind === 'oom') {
        module.heif_js_decode_image2.mockReturnValue({ code: { value: kind === 'oom' ? 6 : 2 } });
        if (kind === 'oom') code = 'out-of-memory';
      }
      if (kind === 'runtime') module.heif_js_decode_image2.mockImplementation(() => { throw new WebAssembly.RuntimeError('trap'); });
      if (kind === 'channels') module.heif_js_decode_image2.mockReturnValue({ image: { delete() {} }, width: 2, height: 1, channels: [] });
      if (kind === 'allocation') code = 'out-of-memory';
      expect(await decodeHeic(module, heic, kind === 'allocation' ? () => { throw new HeicAllocationError(); } : undefined))
        .toEqual({ ok: false, code });
      expect(module.heif_context_free).toHaveBeenCalledTimes(1);
      expect(module.heif_image_handle_release).toHaveBeenCalledTimes(kind === 'primary' ? 0 : 1);
      if (kind !== 'primary') expect(module.heif_image_handle_release).toHaveBeenCalledWith(primary);
      expect(module.heif_image_release).toHaveBeenCalledTimes(['allocation', 'channels'].includes(kind) ? 1 : 0);
      if (['large', 'invalid', 'primary', 'flag'].includes(kind)) expect(module.heif_js_decode_image2).not.toHaveBeenCalled();
    });
  it('rejects a row stride shorter than one row of pixels', async () => {
    const { module } = await mockModule();
    module.heif_js_decode_image2.mockReturnValue({ image: { delete() {} }, width: 2, height: 1,
      channels: [{ id: { value: 10 }, width: 2, height: 1, stride: 4, data: new Uint8Array(16) }] });
    expect(await decodeHeic(module, heic)).toEqual({ ok: false, code: 'decode-failed' });
  });
  it('treats a security-limit refusal as a failed decode, not memory exhaustion', async () => {
    const { module } = await mockModule();
    // The fake's declared result is the success literal; this test needs error codes.
    const read = module.heif_context_read_from_memory as unknown as ReturnType<typeof vi.fn>;
    read.mockReturnValue({ code: { value: 6 }, subcode: { value: 1000 }, message: 'limit' });
    expect(await decodeHeic(module, heic)).toEqual({ ok: false, code: 'decode-failed' });
    read.mockReturnValue({ code: { value: 6 }, subcode: { value: 0 }, message: 'oom' });
    expect(await decodeHeic(module, heic)).toEqual({ ok: false, code: 'out-of-memory' });
  });
  it('releases native owners before transferring and also when a release throws', async () => {
    const { module } = await mockModule();
    const releasedAtSend: number[] = [];
    const api = createHeicWorkerApi({ loadWasm: binary, initialize: async () => module,
      send(_result, buffers) {
        releasedAtSend.push(module.heif_image_release.mock.calls.length,
          module.heif_image_handle_release.mock.calls.length, module.heif_context_free.mock.calls.length);
        throw new Error(`transfer failed for ${buffers.length} buffer`);
      } });
    expect(await api.decode(heic)).toEqual({ ok: false, code: 'decode-failed' });
    expect(releasedAtSend).toEqual([1, 1, 1]);
    module.heif_image_release.mockImplementationOnce(() => { throw new Error('release'); });
    expect((await decodeHeic(module, heic)).ok).toBe(true);
    expect(module.heif_context_free).toHaveBeenCalledTimes(2);
    expect(module.heif_image_handle_release).toHaveBeenCalledTimes(2);
  });
  it('transfers an independent RGBA buffer and preserves decoded pixels', async () => {
    let detached: Uint8ClampedArray | undefined;
    const api = createHeicWorkerApi({ loadWasm: binary, send(result, buffers) {
      if (result.ok) detached = result.value.rgba;
      return structuredClone(result, { transfer: buffers });
    } });
    const result = await api.decode(heic);
    expect(result.ok).toBe(true);
    expect(detached?.byteLength).toBe(0);
    if (result.ok) expect(Array.from(result.value.rgba.slice(0, 4))).toEqual([1, 1, 3, 255]);
  });
  it('allows the exact shared limit before pixel decoding', async () => {
    const { module } = await mockModule();
    module.heif_image_handle_get_width.mockReturnValue(4096);
    module.heif_image_handle_get_height.mockReturnValue(4096);
    module.heif_js_decode_image2.mockReturnValue({ code: { value: 2 } });
    expect(await decodeHeic(module, heic)).toEqual({ ok: false, code: 'decode-failed' });
    expect(module.heif_js_decode_image2).toHaveBeenCalledOnce();
  });
  it('rejects AVIF before initialization and handles init and transfer failures as values', async () => {
    const loadWasm = vi.fn(binary);
    const initialize = vi.fn(realModule);
    const api = createHeicWorkerApi({ loadWasm, initialize, send: () => { throw new Error('transfer'); } });
    expect(await api.decode(avif)).toEqual({ ok: false, code: 'unsupported-type' });
    expect(loadWasm).not.toHaveBeenCalled(); expect(initialize).not.toHaveBeenCalled();
    expect(await api.decode(heic)).toEqual({ ok: false, code: 'decode-failed' });
    expect(loadWasm).toHaveBeenCalledOnce();
    const bad = createHeicWorkerApi({ loadWasm: async () => { throw new Error('missing'); } });
    expect(await bad.decode(heic)).toEqual({ ok: false, code: 'heic-decoder-unavailable' });
    const broken = createHeicWorkerApi({ loadWasm: binary, initialize: async () => { throw new Error('init'); } });
    expect(await broken.ready()).toEqual({ ok: false, code: 'heic-decoder-unavailable' });
    const success = createHeicWorkerApi({ loadWasm: binary });
    expect((await success.decode(heic)).ok).toBe(true);
  });
  it('contains detached input errors without creating a decoder', async () => {
    const bytes = new Uint8Array(heic);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    const { module } = await mockModule();
    expect(await decodeHeic(module, bytes)).toEqual({ ok: false, code: 'decode-failed' });
    expect(module.heif_context_alloc).not.toHaveBeenCalled();
    const loadWasm = vi.fn(binary);
    expect(await createHeicWorkerApi({ loadWasm }).decode(bytes)).toEqual({ ok: false, code: 'decode-failed' });
    expect(loadWasm).not.toHaveBeenCalled();
  });
  it('requests only same-origin WASM with redirects disabled and checks the response', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      const response = new Response(new Uint8Array([1, 2]));
      Object.defineProperty(response, 'url', { value: 'https://example.test/vendor/libheif/libheif.wasm' });
      return response;
    });
    expect(await fetchHeicWasm('https://example.test', fetcher)).toEqual(new Uint8Array([1, 2]));
    expect(fetcher).toHaveBeenCalledWith('https://example.test/vendor/libheif/libheif.wasm',
      { redirect: 'error', credentials: 'same-origin' });
    for (const [url, status, redirected] of [['https://other.test/a', 200, false],
      ['https://example.test/a', 404, false], ['https://example.test/a', 200, true]] as const) {
      fetcher.mockImplementationOnce(async () => {
        const response = new Response(null, { status });
        Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } });
        return response;
      });
      await expect(fetchHeicWasm('https://example.test', fetcher)).rejects.toThrow();
    }
    await expect(fetchHeicWasm('file:///', fetcher)).rejects.toThrow();
  });
});
