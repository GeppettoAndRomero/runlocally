import { afterEach, expect, it, vi } from 'vitest';
import type { ImageConvertRequest } from '../../src/engine/image/worker-protocol';
const mocks = vi.hoisted(() => ({ convert: vi.fn(), terminate: vi.fn(), release: vi.fn(), exposed: undefined as any,
  rescue: vi.fn(), managerStop: vi.fn(), options: undefined as any }));
vi.mock('comlink', () => ({ wrap: () => ({ convert: mocks.convert, terminate: mocks.terminate, ownRescue: () => Promise.resolve(),
  [Symbol.for('release')]: mocks.release }), releaseProxy: Symbol.for('release'), expose: (api: unknown) => { mocks.exposed = api; } }));
vi.mock('../../src/engine/image/heic-client', () => ({ HeicWorkerManager: class {
  rescueDecode = mocks.rescue; terminate = mocks.managerStop;
  constructor(options: unknown) { mocks.options = options; }
} }));
import { connectImageWorker } from '../../src/app/image/client';
class FakeWorker extends EventTarget implements Worker {
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  onerror: Worker['onerror'] = null;
  postMessage = vi.fn(); terminate = vi.fn();
}
afterEach(() => vi.clearAllMocks());
it('checks increasing IDs, mismatched responses, failures and settles pending calls at physical termination', async () => {
  mocks.terminate.mockResolvedValue(undefined);
  mocks.convert.mockImplementation(async (request: ImageConvertRequest) => ({ requestId: request.requestId,
    result: { ok: false, code: 'too-large' } }));
  const worker = new FakeWorker();
  // Structural test double implements the Worker surface used by the client.
  Object.assign(worker, { onmessage: null, onerror: null, onmessageerror: null });
  const client = connectImageWorker(worker);
  await client.convert(new Blob(), 'jpg'); await client.convert(new Blob(), 'png');
  expect(mocks.convert.mock.calls.map(call => call[0].requestId)).toEqual([0, 1]);
  mocks.convert.mockResolvedValueOnce({ requestId: 999, result: { ok: true, value: new Blob() } });
  expect(await client.convert(new Blob(), 'jpg')).toEqual({ ok: false, code: 'interrupted' });
  let late!: (value: unknown) => void;
  mocks.convert.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  const pending = client.convert(new Blob(), 'jpg');
  await Promise.resolve();
  await Promise.resolve();
  client.terminate();
  expect(await pending).toEqual({ ok: false, code: 'interrupted' });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(mocks.terminate).toHaveBeenCalledTimes(1);
  late({ requestId: 3, result: { ok: true, value: new Blob() } });
  expect(await client.convert(new Blob(), 'jpg')).toEqual({ ok: false, code: 'interrupted' });
});
it('owns rescue worker termination without waiting for image worker responses', async () => {
  mocks.terminate.mockReturnValue(new Promise(() => {}));
  const worker = new FakeWorker(); const child = new FakeWorker();
  const client = connectImageWorker(worker, () => child);
  const port = { start: vi.fn(), close: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), postMessage: vi.fn() };
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'image-rescue-open', port } }));
  client.terminate();
  expect(port.close).toHaveBeenCalledTimes(1); expect(child.terminate).toHaveBeenCalledTimes(1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it('composes rescue in the existing image API and retains convert and interrupt', async () => {
  vi.stubGlobal('self', { postMessage: vi.fn() });
  await import('../../src/engine/image/image-worker');
  expect(mocks.exposed.convert).toBeTypeOf('function'); expect(mocks.exposed.interrupt).toBeTypeOf('function');
  expect(mocks.options.factory).toBeTypeOf('function');
  const bytes = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 104, 101, 105, 99]);
  const input = { size: bytes.length, slice: () => ({ arrayBuffer: async () => bytes.buffer }) };
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('native')));
  mocks.rescue.mockResolvedValue({ ok: false, code: 'heic-decoder-unavailable' });
  const result = await mocks.exposed.convert({ requestId: 0, input, format: 'jpg' });
  expect(result.result.code).toBe('heic-decoder-unavailable'); expect(mocks.rescue).toHaveBeenCalledWith(input, expect.any(Function));
  mocks.exposed.terminate(); expect(mocks.managerStop).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
