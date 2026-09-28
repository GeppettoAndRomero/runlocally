import { proxy, releaseProxy, wrap, type Endpoint } from 'comlink';
import type { WorkerApi } from '../engine/worker-api';
import type { ZipEntry, ExtractedFile } from '../engine/types';
import type { RewriteOptions, RewriteResult } from '../engine/zip/rewrite';
import type { CreateOptions } from '../engine/zip/create';
import type { SplitPart, SplitProgress } from '../engine/zip/split';
import type { MergeOptions, MergeProgress, MergeResult } from '../engine/zip/merge';
import type { RecoverResult } from '../engine/recover/recoverEngine';
import { registerEngineErrorTransfer } from '../engine/worker-protocol';
import { openArchive as openLibarchive, type OpenArchive } from '../engine/archive/libarchive';

export interface ZipEngineClient {
  listEntries(file: File): Promise<ZipEntry[]>;
  extractEntry(file: File, name: string): Promise<Blob>;
  extractAll(file: File, onProgress?: (done: number, total: number) => unknown): Promise<ExtractedFile[]>;
  rewriteZip(file: File, options?: RewriteOptions): Promise<RewriteResult>;
  createZip(files: File[], options?: CreateOptions): Promise<Blob>;
  splitZip(file: File, targetBytes: number,
    onProgress?: (progress: SplitProgress) => unknown): Promise<SplitPart[]>;
  mergeZips(files: File[], options: MergeOptions,
    onProgress?: (progress: MergeProgress) => unknown): Promise<MergeResult>;
  recoverZip(input: ArrayBuffer | Uint8Array): Promise<RecoverResult>;
  terminate(): void;
}

interface WorkerEndpoint extends Endpoint {
  terminate(): void;
  addEventListener(type: 'error' | 'messageerror', listener: EventListener): void;
  removeEventListener(type: 'error' | 'messageerror', listener: EventListener): void;
}

function abortError(): DOMException {
  return new DOMException('ZIP engine terminated', 'AbortError');
}

/** Internal endpoint seam for MessageChannel tests. */
export function __createZipEngineForEndpoint(endpoint: WorkerEndpoint,
  pageEvents: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined =
    typeof window === 'undefined' ? undefined : window): ZipEngineClient {
  registerEngineErrorTransfer();
  const remote = wrap<WorkerApi>(endpoint);
  let ended = false;
  const pending = new Set<(reason: unknown) => void>();
  function run<T>(operation: () => Promise<T>): Promise<T> {
    if (ended) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      pending.add(reject);
      try {
        operation().then(
          (value) => { pending.delete(reject); if (!ended) resolve(value); },
          (reason: unknown) => { pending.delete(reject); if (!ended) reject(reason); },
        );
      } catch (reason) {
        pending.delete(reject);
        reject(reason);
      }
    });
  }
  function guarded<T extends (...args: never[]) => unknown>(callback?: T): T | undefined {
    if (!callback) return undefined;
    return ((...args: Parameters<T>) => {
      if (ended) throw abortError();
      return callback(...args);
    }) as T;
  }
  function terminate(): void {
    if (ended) return;
    ended = true;
    pageEvents?.removeEventListener('pagehide', onPageHide);
    endpoint.removeEventListener('error', onFailure);
    endpoint.removeEventListener('messageerror', onFailure);
    for (const reject of pending) reject(abortError());
    pending.clear();
    try { remote[releaseProxy](); } catch { /* Physical termination still follows. */ }
    endpoint.terminate();
  }
  const onPageHide = () => terminate();
  const onFailure = () => terminate();
  pageEvents?.addEventListener('pagehide', onPageHide);
  endpoint.addEventListener('error', onFailure);
  endpoint.addEventListener('messageerror', onFailure);

  return {
    listEntries: (file) => run(() => remote.listEntries(file)),
    extractEntry: (file, name) => run(() => remote.extractEntry(file, name)),
    extractAll: (file, onProgress) => run(() => remote.extractAll(file,
      onProgress ? proxy(guarded(onProgress)!) : undefined)),
    rewriteZip: (file, options = {}) => run(() => {
      const { keep, rename, onProgress, ...data } = options;
      return remote.rewriteZip(file, data,
        keep ? proxy(guarded(keep)!) : undefined,
        rename ? proxy(guarded(rename)!) : undefined,
        onProgress ? proxy(guarded(onProgress)!) : undefined);
    }),
    createZip: (files, options = {}) => run(() => {
      const { onProgress, ...data } = options;
      return remote.createZip(files.map((file) => ({ file,
        relativePath: file.webkitRelativePath || '' })), data,
      onProgress ? proxy(guarded(onProgress)!) : undefined);
    }),
    splitZip: (file, targetBytes, onProgress) => run(() => remote.splitZip(file, targetBytes,
      onProgress ? proxy(guarded(onProgress)!) : undefined)),
    mergeZips: (files, options, onProgress) => run(() => remote.mergeZips(files, options,
      onProgress ? proxy(guarded(onProgress)!) : undefined)),
    recoverZip: (input) => run(() => remote.recoverZip(input)),
    terminate,
  };
}

export function createZipEngine(): ZipEngineClient {
  const worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
  return __createZipEngineForEndpoint(worker);
}

/** Direct libarchive route. The caller closes handles after single extraction, failure or discard. */
export function openArchive(file: File): Promise<OpenArchive> {
  return openLibarchive(file);
}
