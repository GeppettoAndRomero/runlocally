import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expose, type Endpoint } from 'comlink';
import { configure } from '@zip.js/zip.js';
import { workerApi } from '../../src/engine/worker-api';
import { registerEngineErrorTransfer } from '../../src/engine/worker-protocol';
import { __createZipEngineForEndpoint } from '../../src/app/engine';
import { EngineError } from '../../src/engine/errors';
import { decodeShiftJisName } from '../../src/engine/zip/names';

configure({ useWebWorkers: false });
registerEngineErrorTransfer();
const clients: Array<ReturnType<typeof __createZipEngineForEndpoint>> = [];
afterEach(() => { for (const client of clients.splice(0)) client.terminate(); });
function connect(api: object = workerApi) {
  const { port1, port2 } = new MessageChannel();
  expose(api, port2 as unknown as Endpoint);
  const endpoint = Object.assign(port1, {
    terminate: vi.fn(() => { port1.close(); port2.close(); }),
  });
  const page = new EventTarget();
  const client = __createZipEngineForEndpoint(endpoint as never, page as never);
  clients.push(client);
  return { client, endpoint, page };
}
const file = (name: string, content: string) => new File([content], name);

describe('app Comlink boundary', () => {
  it('moves File, Blob, Date and callbacks across a real MessageChannel', async () => {
    const { client } = connect();
    const source = file('a.txt', 'content');
    Object.defineProperty(source, 'webkitRelativePath', { value: 'folder/a.txt' });
    const seen: string[] = [];
    const blob = await client.createZip([source], { onProgress: async (p) => { seen.push(p.name); } });
    const zip = new File([blob], 'created.zip');
    const entries = await client.listEntries(zip);
    expect(entries[0].name).toBe('folder/a.txt');
    expect(entries[0].date).toBeInstanceOf(Date);
    expect(seen).toEqual(['a.txt']);
    expect(await (await client.extractEntry(zip, 'folder/a.txt')).text()).toBe('content');
    const progress: number[] = [];
    const rewritten = await client.rewriteZip(zip, {
      keep: async () => true,
      rename: async () => 'renamed.txt',
      onProgress: async (p) => { progress.push(p.index); },
    });
    expect(progress).toEqual([0]);
    expect((await client.listEntries(new File([rewritten.blob], 'rewritten.zip')))[0].name).toBe('renamed.txt');
    const input = await blob.arrayBuffer();
    expect((await client.recoverZip(input)).entries[0].bytes).toBeInstanceOf(Uint8Array);
    expect(input.byteLength).toBeGreaterThan(0);
  });
  it('awaits remote progress before each operation completes', async () => {
    const { client } = connect();
    const zipBlob = await client.createZip([file('a.txt', 'a'), file('b.txt', 'b')]);
    const zip = new File([zipBlob], 'source.zip');
    const extracted: number[] = [];
    await client.extractAll(zip, async (done) => {
      await Promise.resolve();
      extracted.push(done);
    });
    expect(extracted).toEqual([1, 2]);
    const split: number[] = [];
    await client.splitZip(zip, 10000, async ({ part }) => {
      await Promise.resolve();
      split.push(part);
    });
    expect(split).toEqual([1]);
    const merged: number[] = [];
    await client.mergeZips([zip, zip], { collision: 'skip' }, async ({ index }) => {
      await Promise.resolve();
      merged.push(index);
    });
    expect(merged).toEqual([0, 1]);
  });
  it('clones raw filename bytes for a remote rename callback', async () => {
    const { client } = connect();
    const bytes = readFileSync(fileURLToPath(new URL('../fixtures/zip/rewrite/mojibake.zip', import.meta.url)));
    let raw: Uint8Array | undefined;
    const result = await client.rewriteZip(new File([bytes], 'mojibake.zip'), {
      rename: async (_name, entry) => {
        raw = entry.rawFilename;
        return decodeShiftJisName(entry);
      },
    });
    expect(raw).toBeInstanceOf(Uint8Array);
    expect((await client.listEntries(new File([result.blob], 'renamed.zip')))[0].name).toBe('メモ帳.txt');
  });
  it('keeps EngineError code and preserves other thrown values', async () => {
    const { client } = connect({
      ...workerApi,
      listEntries: async () => { throw new EngineError('too-large', 'limit', { cause: () => 1 }); },
      extractEntry: async () => { throw new Error('plain'); },
      extractAll: async () => { throw 'value'; },
    });
    await expect(client.listEntries(file('x', 'x'))).rejects.toMatchObject({ code: 'too-large', message: 'limit' });
    await expect(client.extractEntry(file('x', 'x'), 'x')).rejects.toMatchObject({ message: 'plain' });
    await expect(client.extractAll(file('x', 'x'))).rejects.toBe('value');
  });
  it('preserves all six error codes and a callback EngineError', async () => {
    const codes = ['wrong-password', 'not-encrypted', 'encrypted-entry',
      'bad-central', 'too-large', 'unsupported'] as const;
    for (const code of codes) {
      const { client } = connect({ ...workerApi,
        listEntries: async () => { throw new EngineError(code, code); },
      });
      await expect(client.listEntries(file('x', 'x'))).rejects.toMatchObject({ code, message: code });
      client.terminate();
    }
    const { client } = connect();
    const blob = await client.createZip([file('a.txt', 'a')]);
    await expect(client.rewriteZip(new File([blob], 'a.zip'), {
      keep: () => { throw new EngineError('unsupported', 'callback rejected'); },
    })).rejects.toMatchObject({ code: 'unsupported', message: 'callback rejected' });
  });
  it('rejects pending and later calls on termination, including pagehide', async () => {
    const { client, endpoint, page } = connect({ ...workerApi,
      listEntries: () => new Promise(() => {}),
    });
    const pending = client.listEntries(file('x', 'x'));
    page.dispatchEvent(new Event('pagehide'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.listEntries(file('x', 'x'))).rejects.toMatchObject({ name: 'AbortError' });
    client.terminate();
    expect(endpoint.terminate).toHaveBeenCalledTimes(1);
  });
  it('rejects pending calls on worker error', async () => {
    const { client, endpoint } = connect({ ...workerApi,
      listEntries: () => new Promise(() => {}),
    });
    const pending = client.listEntries(file('x', 'x'));
    endpoint.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
