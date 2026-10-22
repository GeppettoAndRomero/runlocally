import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ convert: vi.fn(), release: vi.fn(), terminate: vi.fn(async () => {}) }));
vi.mock('comlink', () => ({ wrap: () => ({ ...mocks, ownRescue: async () => {}, [Symbol.for('release')]: mocks.release }), releaseProxy: Symbol.for('release') }));
import { connectImageWorker } from '../../src/app/image/client';
class FakeWorker extends EventTarget {
  postMessage = vi.fn(); terminate = vi.fn();
  send(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.clearAllMocks());
it('routes by pending request ID, validates stages and removes callbacks before resolving', async () => {
  const worker = new FakeWorker(); const remove = vi.spyOn(worker, 'removeEventListener');
  const client = connectImageWorker(worker as unknown as Worker);
  const resolvers: ((value: unknown) => void)[] = [];
  mocks.convert.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
  const a = vi.fn(); const b = vi.fn();
  const first = client.convert(new Blob(), 'png', a); const second = client.convert(new Blob(), 'png', b);
  await tick();
  for (const [requestId, stage] of [[0, 'reading'], [1, 'decoding'], [99, 'encoding'], [-1, 'reading'], [0.5, 'reading'], ['0', 'reading'], [0, 'invalid']]) {
    worker.send({ type: 'image-progress', requestId, stage });
  }
  expect(a.mock.calls).toEqual([['reading']]); expect(b.mock.calls).toEqual([['decoding']]);
  resolvers[0]({ requestId: 0, result: { ok: false, code: 'too-large' } });
  await first; worker.send({ type: 'image-progress', requestId: 0, stage: 'encoding' });
  expect(a).toHaveBeenCalledOnce();
  resolvers[1]({ requestId: 999, result: { ok: true, value: new Blob() } });
  expect(await second).toEqual({ ok: false, code: 'interrupted' });
  worker.send({ type: 'image-progress', requestId: 1, stage: 'drawing' }); expect(b).toHaveBeenCalledOnce();
  client.terminate(); expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
  worker.send({ type: 'image-progress', requestId: 1, stage: 'encoding' }); expect(b).toHaveBeenCalledOnce();
});
it('cleans rejected and interrupted requests, isolates callbacks and coexists with rescue messages', async () => {
  const worker = new FakeWorker(); const child = new FakeWorker();
  const client = connectImageWorker(worker as unknown as Worker, () => child as unknown as Worker);
  const stage = vi.fn(() => { throw new Error('observer'); });
  mocks.convert.mockRejectedValueOnce(new Error('rpc'));
  expect(await client.convert(new Blob(), 'jpg', stage)).toEqual({ ok: false, code: 'decode-failed' });
  worker.send({ type: 'image-progress', requestId: 0, stage: 'reading' }); expect(stage).not.toHaveBeenCalled();
  mocks.convert.mockImplementation(() => new Promise(() => {}));
  const pending = client.convert(new Blob(), 'png', stage); await tick();
  worker.send({ type: 'image-progress', requestId: 1, stage: 'reading' }); expect(stage).toHaveBeenCalledOnce();
  const port = { start: vi.fn(), close: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), postMessage: vi.fn() };
  worker.send({ type: 'image-rescue-open', port });
  client.terminate(); expect(await pending).toEqual({ ok: false, code: 'interrupted' });
  expect(port.close).toHaveBeenCalledOnce(); expect(child.terminate).toHaveBeenCalledOnce();
  worker.send({ type: 'image-progress', requestId: 1, stage: 'encoding' }); expect(stage).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
});
