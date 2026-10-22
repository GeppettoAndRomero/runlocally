import type { ImageStage } from '../../engine/image/convert';
import { wrap, releaseProxy, type Endpoint } from 'comlink';
import type { createImageWorkerApi } from '../../engine/image/worker-api';
import type { ImageOutputFormat, ImageResult } from '../../engine/image/types';

export interface ImageClient {
  convert(input: Blob, format: ImageOutputFormat, onStage?: (stage: ImageStage) => void): Promise<ImageResult<Blob>>;
  terminate(): void;
  /** True once the client has been terminated, explicitly or after a worker failure. */
  readonly stopped?: boolean;
}
type Api = ReturnType<typeof createImageWorkerApi> & { terminate(): void; ownRescue(): void };
export function createImageClient(): ImageClient {
  return connectImageWorker(new Worker(new URL('../../engine/image/image-worker.ts', import.meta.url), { type: 'module' }));
}
// The client owns every physical worker, including the lazily requested rescue
// worker. Departure never depends on a remote termination acknowledgement.
export function connectImageWorker(worker: Worker,
  rescueFactory = () => new Worker(new URL('../../engine/image/heic-worker.ts', import.meta.url), { type: 'module' })): ImageClient {
  let stopped = false;
  let nextId = 0;
  const pending = new Map<number, { finish: () => void; onStage?: (stage: ImageStage) => void }>();
  const children = new Set<() => void>();
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const endpoint: Endpoint = {
    postMessage(message: unknown, transfers?: Transferable[]) { if (!stopped) worker.postMessage(message, transfers ?? []); },
    addEventListener(type, listener) { listeners.add(listener); worker.addEventListener(type, listener); },
    removeEventListener(type, listener) { listeners.delete(listener); worker.removeEventListener(type, listener); },
  };
  const remote = wrap<Api>(endpoint);
  const ready = remote.ownRescue();
  const onMessage = (event: MessageEvent) => {
    const message = event.data;
    if (message?.type === 'image-progress') {
      if (!stopped && Number.isSafeInteger(message.requestId) &&
        ['reading', 'decoding', 'heic-decoder-preparing', 'drawing', 'encoding'].includes(message.stage)) {
        try { pending.get(message.requestId)?.onStage?.(message.stage); } catch { /* Observers cannot settle requests. */ }
      }
      return;
    }
    if (message?.type !== 'image-rescue-open') return;
    const port: MessagePort = event.data.port;
    if (stopped) { port.close(); return; }
    let child: Worker;
    try { child = rescueFactory(); }
    catch { port.postMessage({ type: 'image-rescue-failed' }); port.close(); return; }
    const close = () => {
      child.removeEventListener('message', reply);
      child.removeEventListener('error', failure);
      child.removeEventListener('messageerror', failure);
      port.removeEventListener('message', send);
      port.close(); child.terminate(); children.delete(close);
    };
    const failure = () => { port.postMessage({ type: 'image-rescue-failed' }); close(); };
    const reply = (message: MessageEvent) => port.postMessage(message.data);
    const send = (message: MessageEvent) => {
      if (message.data?.type === 'image-rescue-close') close();
      else child.postMessage(message.data);
    };
    children.add(close);
    child.addEventListener('message', reply);
    child.addEventListener('error', failure);
    child.addEventListener('messageerror', failure);
    port.addEventListener('message', send); port.start();
  };
  const terminate = () => {
    if (stopped) return;
    try { void remote.terminate().catch(() => {}); } catch { /* Physical termination follows. */ }
    stopped = true;
    for (const { finish } of pending.values()) finish();
    pending.clear();
    for (const close of children) close();
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', terminate);
    worker.removeEventListener('messageerror', terminate);
    try { remote[releaseProxy](); } catch { /* Release the endpoint regardless. */ }
    for (const listener of listeners) worker.removeEventListener('message', listener);
    listeners.clear(); worker.terminate();
  };
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', terminate);
  worker.addEventListener('messageerror', terminate);
  return {
    get stopped() { return stopped; },
    convert(input, format, onStage) {
      if (stopped || !Number.isSafeInteger(nextId)) return Promise.resolve({ ok: false, code: 'interrupted' });
      const requestId = nextId++;
      return new Promise(resolve => {
        const finish = () => { pending.delete(requestId); resolve({ ok: false, code: 'interrupted' }); };
        pending.set(requestId, { finish, onStage });
        ready.then(() => stopped
          ? { type: 'result' as const, requestId, result: { ok: false as const, code: 'interrupted' as const } }
          : remote.convert({ type: 'convert', requestId, input, format })).then(response => {
          pending.delete(requestId);
          if (!stopped) resolve(response.requestId === requestId ? response.result : { ok: false, code: 'interrupted' });
        }, () => { pending.delete(requestId); if (!stopped) resolve({ ok: false, code: 'decode-failed' }); });
      });
    }, terminate,
  };
}
