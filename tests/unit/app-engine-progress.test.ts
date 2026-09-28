import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { expose, type Endpoint } from 'comlink';
import { configure } from '@zip.js/zip.js';
import { workerApi } from '../../src/engine/worker-api';
import { registerEngineErrorTransfer } from '../../src/engine/worker-protocol';
import { __createZipEngineForEndpoint } from '../../src/app/engine';

// Progress callbacks may return anything (a function, a DOM-like object); the value must not
// cross the boundary, or Comlink fails the whole call with an unserializable return value.
configure({ useWebWorkers: false });
registerEngineErrorTransfer();
const clients: Array<ReturnType<typeof __createZipEngineForEndpoint>> = [];
afterEach(() => { for (const client of clients.splice(0)) client.terminate(); });
function connect() {
  const { port1, port2 } = new MessageChannel();
  expose(workerApi, port2 as unknown as Endpoint);
  const endpoint = Object.assign(port1, { terminate: vi.fn(() => { port1.close(); port2.close(); }) });
  const client = __createZipEngineForEndpoint(endpoint as never, new EventTarget() as never);
  clients.push(client);
  return client;
}

describe('progress callbacks across the worker boundary', () => {
  it('ignores unserializable return values from progress callbacks', async () => {
    const client = connect();
    const calls: number[] = [];
    const blob = await client.createZip([new File(['one'], 'a.txt'), new File(['two'], 'b.txt')], {
      onProgress: (p) => { calls.push(p.index); return () => p.index; },
    });
    expect(calls).toEqual([0, 1]);
    const done: number[] = [];
    const files = await client.extractAll(new File([blob], 'x.zip'), (d) => { done.push(d); return { self: globalThis }; });
    expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
    expect(done).toEqual([1, 2]);
  });
});
