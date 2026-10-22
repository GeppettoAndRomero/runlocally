import { convertImage, decodeNativeImage, createOffscreenImageCanvas } from './convert';
import type { ImageAdapters } from './convert';
import type { ImageConvertRequest, ImageInterruptRequest, ImageWorkerResult, ImageProgressMessage } from './worker-protocol';

// IDs must increase for the lifetime of a worker. Only one conversion runs at a time.
export function createImageWorkerApi(adapters?: ImageAdapters, post?: (message: ImageProgressMessage) => void) {
  let lastId = -1;
  let stopped = false;
  let active: { requestId: number; interrupted: boolean } | undefined;
  return {
    async convert(request: ImageConvertRequest): Promise<ImageWorkerResult> {
      const response = (result: ImageWorkerResult['result']): ImageWorkerResult =>
        ({ type: 'result', requestId: request.requestId, result });
      if (stopped || !Number.isSafeInteger(request.requestId) || request.requestId <= lastId) {
        return response({ ok: false, code: 'interrupted' });
      }
      lastId = request.requestId;
      if (active) return response({ ok: false, code: 'interrupted' });
      const job = { requestId: request.requestId, interrupted: false };
      active = job;
      try {
        const result = await convertImage(request.input, request.format, {
          decode: adapters?.decode ?? decodeNativeImage,
          canvas: adapters?.canvas ?? createOffscreenImageCanvas,
          rescueDecode: adapters?.rescueDecode,
          onStage: stage => {
            if (stopped || active !== job || job.interrupted || adapters?.interrupted?.()) return;
            try { adapters?.onStage?.(stage); } catch { /* Keep the transport independent of observers. */ }
            if (!stopped && active === job && !job.interrupted && !adapters?.interrupted?.()) post?.({ type: 'image-progress', requestId: job.requestId, stage });
          },
          interrupted: () => job.interrupted || adapters?.interrupted?.() === true,
        });
        return response(job.interrupted ? { ok: false, code: 'interrupted' } : result);
      } finally {
        active = undefined;
      }
    },
    terminate(): void { stopped = true; if (active) active.interrupted = true; },
    interrupt(request: ImageInterruptRequest): void {
      if (active?.requestId === request.requestId) active.interrupted = true;
    },
  };
}
