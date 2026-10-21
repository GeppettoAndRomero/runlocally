import { expose, wrap, releaseProxy } from 'comlink';
import { createImageWorkerApi } from './worker-api';
import { HeicWorkerManager, createHeicConnection, type HeicConnection } from './heic-client';
import { decodeNativeImage, createOffscreenImageCanvas } from './convert';
import type { HeicWorkerApi } from './libheif-adapter';

// The owning client creates and terminates the rescue worker. Only ports cross
// this boundary; decoded images and adapter functions stay in this worker.
function rescueConnection(): HeicConnection {
  const { port1, port2 } = new MessageChannel();
  self.postMessage({ type: 'image-rescue-open', port: port2 }, { transfer: [port2] });
  const remote = wrap<HeicWorkerApi>(port1);
  return {
    ready: () => remote.ready(), decode: bytes => remote.decode(bytes),
    subscribeFailure(listener) {
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'image-rescue-failed') listener();
      };
      port1.addEventListener('message', onMessage);
      port1.start();
      return () => port1.removeEventListener('message', onMessage);
    },
    release: () => { remote[releaseProxy](); },
    terminate: () => { port1.postMessage({ type: 'image-rescue-close' }); port1.close(); },
  };
}
let ownedRescue = false;
const manager = new HeicWorkerManager({ factory: () => ownedRescue ? rescueConnection() : createHeicConnection() });
const api = createImageWorkerApi({ decode: decodeNativeImage,
  canvas: createOffscreenImageCanvas, rescueDecode: manager.rescueDecode });
expose({ ...api, ownRescue: () => { ownedRescue = true; }, terminate: () => manager.terminate() });
