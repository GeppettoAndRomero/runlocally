import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { convertImage, mainThreadImageCanvas, type ImageAdapters, type ImageStage } from '../../src/engine/image/convert';
import { HeicWorkerManager, type HeicConnection } from '../../src/engine/image/heic-client';
import { createImageWorkerApi } from '../../src/engine/image/worker-api';

const input = (name = 'alpha.png') => new Blob([readFileSync(`tests/fixtures/image/${name}`)]);
function setup() {
  const stages: ImageStage[] = [];
  const image = { width: 2, height: 2, paint: vi.fn(), close: vi.fn() };
  const canvas = { context: { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() },
    encode: vi.fn(async () => new Blob(['x'], { type: 'image/png' })), release: vi.fn() };
  const adapters: ImageAdapters = { decode: vi.fn(async () => image), canvas: () => canvas, onStage: stage => stages.push(stage) };
  return { stages, image, canvas, adapters };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
it('reports actual boundaries with a caller-created main-thread canvas and isolates observer exceptions', async () => {
  const s = setup();
  const dom = { width: 0, height: 0, getContext: () => s.canvas.context,
    toBlob: (callback: BlobCallback) => callback(new Blob(['x'], { type: 'image/png' })) };
  s.adapters.canvas = mainThreadImageCanvas(() => dom);
  s.adapters.onStage = stage => { s.stages.push(stage); throw new Error('observer'); };
  expect((await convertImage(input(), 'png', s.adapters)).ok).toBe(true);
  expect(s.stages).toEqual(['reading', 'decoding', 'drawing', 'encoding']);
  expect(s.image.close).toHaveBeenCalledOnce(); expect(dom.width).toBe(0);
});
it('does not report unreachable stages on read, decode, dimension and paint failures', async () => {
  const s = setup();
  await convertImage(new Blob(['unknown']), 'png', s.adapters);
  expect(s.stages).toEqual(['reading']);
  s.stages.length = 0; s.image.width = 0;
  await convertImage(input(), 'png', s.adapters);
  expect(s.stages).toEqual(['reading', 'decoding']);
  s.stages.length = 0; s.image.width = 2; s.image.paint.mockImplementation(() => { throw new Error('paint'); });
  await convertImage(input(), 'png', s.adapters);
  expect(s.stages).toEqual(['reading', 'decoding', 'drawing']);
  s.stages.length = 0; s.adapters.decode = async () => { throw new Error('decode'); };
  await convertImage(input(), 'png', s.adapters);
  expect(s.stages).toEqual(['reading', 'decoding']);
});
it('stops notifications after interruption and still closes a late decoded image', async () => {
  const s = setup(); const pending = deferred<typeof s.image>(); let interrupted = false;
  s.adapters.decode = () => pending.promise; s.adapters.interrupted = () => interrupted;
  const result = convertImage(input(), 'png', s.adapters);
  await vi.waitFor(() => expect(s.stages).toEqual(['reading', 'decoding']));
  interrupted = true; pending.resolve(s.image);
  expect(await result).toEqual({ ok: false, code: 'interrupted' });
  expect(s.image.close).toHaveBeenCalledOnce(); expect(s.stages).toHaveLength(2);
});
it.each(['success', 'failure', 'terminate', 'observer'] as const)('separates HEIC ready and decode: %s', async mode => {
  const s = setup(); const ready = deferred<Awaited<ReturnType<HeicConnection['ready']>>>();
  const connection: HeicConnection = { ready: () => ready.promise,
    decode: vi.fn(async () => ({ ok: true as const, value: { width: 2, height: 2, rgba: new Uint8ClampedArray(16) } })),
    subscribeFailure: () => () => {}, release: vi.fn(), terminate: vi.fn() };
  const manager = new HeicWorkerManager({ factory: () => connection, toImage: async () => s.image });
  s.adapters.decode = async () => { throw new Error('native'); }; s.adapters.rescueDecode = manager.rescueDecode;
  if (mode === 'observer') s.adapters.onStage = stage => { s.stages.push(stage); throw new Error('observer'); };
  const result = convertImage(input('sample.heic'), 'png', s.adapters);
  await vi.waitFor(() => expect(s.stages).toEqual(['reading', 'decoding', 'heic-decoder-preparing']));
  expect(connection.decode).not.toHaveBeenCalled();
  if (mode === 'terminate') manager.terminate();
  ready.resolve(mode === 'failure' ? { ok: false, code: 'heic-decoder-unavailable' } : { ok: true, value: null });
  expect((await result).ok).toBe(mode === 'success' || mode === 'observer');
  expect(s.stages).toEqual(mode === 'success' || mode === 'observer'
    ? ['reading', 'decoding', 'heic-decoder-preparing', 'decoding', 'drawing', 'encoding']
    : ['reading', 'decoding', 'heic-decoder-preparing']);
  if (mode === 'terminate' || mode === 'failure') expect(connection.decode).not.toHaveBeenCalled();
});
it.each(['sample.heic', 'sample.avif', 'alpha.png'])('does not invent preparation for native %s or an absent rescue adapter', async name => {
  const s = setup(); await convertImage(input(name), 'png', s.adapters);
  expect(s.stages).toEqual(['reading', 'decoding', 'drawing', 'encoding']);
  s.stages.length = 0; s.adapters.decode = async () => { throw new Error('native'); };
  await convertImage(input(name), 'png', s.adapters);
  expect(s.stages).toEqual(['reading', 'decoding']);
});
it('sends accepted IDs only and stops sending on interrupt, completion and termination', async () => {
  const s = setup(); const pending = deferred<typeof s.image>(); s.adapters.decode = () => pending.promise;
  const post = vi.fn(); const api = createImageWorkerApi(s.adapters, post);
  const run = api.convert({ type: 'convert', requestId: 4, input: input(), format: 'png' });
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls.map(([message]) => message)).toEqual([
    { type: 'image-progress', requestId: 4, stage: 'reading' }, { type: 'image-progress', requestId: 4, stage: 'decoding' }]);
  await api.convert({ type: 'convert', requestId: 5, input: input(), format: 'png' });
  api.interrupt({ type: 'interrupt', requestId: 4 }); pending.resolve(s.image); await run;
  expect(post).toHaveBeenCalledTimes(2);
  api.terminate(); await api.convert({ type: 'convert', requestId: 6, input: input(), format: 'png' });
  expect(post).toHaveBeenCalledTimes(2);
});
it('isolates transport exceptions and suppresses later notifications after terminate during a stage', async () => {
  const s = setup(); const post = vi.fn(() => { throw new Error('transport'); });
  const api = createImageWorkerApi(s.adapters, post);
  expect((await api.convert({ type: 'convert', requestId: 0, input: input(), format: 'png' })).result.ok).toBe(true);
  expect(post).toHaveBeenCalledTimes(4);
  const stopped = createImageWorkerApi(s.adapters, () => stopped.terminate());
  expect((await stopped.convert({ type: 'convert', requestId: 0, input: input(), format: 'png' })).result)
    .toEqual({ ok: false, code: 'interrupted' });
});
it('discards retained rescue callbacks after the job finishes and after a different job starts', async () => {
  const s = setup(); const post = vi.fn();
  let late!: (stage: ImageStage) => void;
  s.adapters.decode = async () => { throw new Error('native'); };
  s.adapters.rescueDecode = async (_input, onStage) => {
    late = onStage!; onStage?.('heic-decoder-preparing'); onStage?.('decoding');
    return { ok: true, value: s.image };
  };
  const api = createImageWorkerApi(s.adapters, post);
  await api.convert({ type: 'convert', requestId: 0, input: input('sample.heic'), format: 'png' });
  const count = post.mock.calls.length; late('encoding'); expect(post).toHaveBeenCalledTimes(count);
  const next = deferred<typeof s.image>(); s.adapters.decode = () => next.promise;
  const result = api.convert({ type: 'convert', requestId: 1, input: input(), format: 'png' });
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(count + 2));
  late('drawing'); expect(post).toHaveBeenCalledTimes(count + 2);
  next.resolve(s.image); await result;
});
it('retains a ready rescue connection for queued jobs and isolates direct manager observers', async () => {
  const s = setup(); const ready = deferred<Awaited<ReturnType<HeicConnection['ready']>>>();
  const connection: HeicConnection = { ready: () => ready.promise,
    decode: vi.fn(async () => ({ ok: true as const, value: { width: 2, height: 2, rgba: new Uint8ClampedArray(16) } })),
    subscribeFailure: () => () => {}, release: vi.fn(), terminate: vi.fn() };
  const factory = vi.fn(() => connection);
  const manager = new HeicWorkerManager({ factory, toImage: async () => s.image });
  const firstStages: ImageStage[] = []; const secondStages: ImageStage[] = [];
  const first = manager.rescueDecode(input('sample.heic'), stage => { firstStages.push(stage); throw new Error('observer'); });
  const second = manager.rescueDecode(input('sample.heic'), stage => secondStages.push(stage));
  await vi.waitFor(() => expect(firstStages).toEqual(['heic-decoder-preparing']));
  ready.resolve({ ok: true, value: null });
  expect((await first).ok).toBe(true); expect((await second).ok).toBe(true);
  expect(firstStages).toEqual(['heic-decoder-preparing', 'decoding']); expect(secondStages).toEqual(['decoding']);
  expect(factory).toHaveBeenCalledOnce(); expect(connection.terminate).toHaveBeenCalledOnce();
});
