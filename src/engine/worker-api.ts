import { releaseProxy } from 'comlink';
import { listEntries } from './zip/list';
import { extractEntry, extractAll } from './zip/extract';
import { rewriteZip, type RewriteOptions, type RewriteEntry } from './zip/rewrite';
import { createZip, type CreateOptions } from './zip/create';
import { splitZip } from './zip/split';
import { mergeZips, type MergeOptions } from './zip/merge';
import { recoverZip } from './recover/recoverEngine';

export type RewriteData = Omit<RewriteOptions, 'keep' | 'rename' | 'onProgress'>;
export type CreateData = Omit<CreateOptions, 'onProgress'>;
export interface CreateFileInput { file: File; relativePath: string }
export type RemoteCallback<T extends (...args: never[]) => unknown> = T & {
  [releaseProxy]?: () => void;
};
export interface RewriteCallbacks {
  keep?: RemoteCallback<(name: string) => boolean | Promise<boolean>>;
  rename?: RemoteCallback<(name: string, entry: RewriteEntry) => string | Promise<string>>;
  onProgress?: RemoteCallback<NonNullable<RewriteOptions['onProgress']>>;
}

function release(...callbacks: Array<{ [releaseProxy]?: () => void } | undefined>): void {
  for (const callback of callbacks) {
    try { callback?.[releaseProxy]?.(); } catch { /* A closed port needs no release. */ }
  }
}

/** Exactly the ZIP operations exposed by the worker. */
export const workerApi = {
  listEntries,
  extractEntry,
  async extractAll(file: File, onProgress?: RemoteCallback<(done: number, total: number) => unknown>) {
    try { return await extractAll(file, onProgress); }
    finally { release(onProgress); }
  },
  async rewriteZip(file: File, data: RewriteData = {},
    keep?: RemoteCallback<NonNullable<RewriteOptions['keep']>>,
    rename?: RemoteCallback<NonNullable<RewriteOptions['rename']>>,
    onProgress?: RemoteCallback<NonNullable<RewriteOptions['onProgress']>>) {
    try { return await rewriteZip(file, { ...data, keep, rename, onProgress }); }
    finally { release(keep, rename, onProgress); }
  },
  async createZip(files: CreateFileInput[], data: CreateData = {},
    onProgress?: RemoteCallback<NonNullable<CreateOptions['onProgress']>>) {
    try {
      const restored = files.map(({ file, relativePath }) => {
        if (!relativePath) return file;
        const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
        Object.defineProperty(copy, 'webkitRelativePath', { value: relativePath });
        return copy;
      });
      return await createZip(restored, { ...data, onProgress });
    } finally { release(onProgress); }
  },
  async splitZip(file: File, targetBytes: number,
    onProgress?: RemoteCallback<NonNullable<Parameters<typeof splitZip>[2]>>) {
    try { return await splitZip(file, targetBytes, onProgress); }
    finally { release(onProgress); }
  },
  async mergeZips(files: File[], options: MergeOptions,
    onProgress?: RemoteCallback<NonNullable<Parameters<typeof mergeZips>[2]>>) {
    try { return await mergeZips(files, options, onProgress); }
    finally { release(onProgress); }
  },
  recoverZip,
};

export type WorkerApi = typeof workerApi;
