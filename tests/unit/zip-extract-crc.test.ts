import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { configure } from '@zip.js/zip.js';
import { expose, type Endpoint } from 'comlink';
import { extractAll, extractEntry } from '../../src/engine/zip/extract';
import { listEntries } from '../../src/engine/zip/list';
import { workerApi } from '../../src/engine/worker-api';
import { EngineError } from '../../src/engine/errors';
import { registerEngineErrorTransfer } from '../../src/engine/worker-protocol';
import { ui } from '../../src/i18n/ui';
import { failureText } from '../../src/app/workbench-errors';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import { WorkbenchController } from '../../src/app/workbench-controller';
import type { Session } from '../../src/app/state/session';
import { __createZipEngineForEndpoint } from '../../src/app/engine';

let engineFactory: () => ReturnType<typeof __createZipEngineForEndpoint>;
vi.mock('../../src/app/engine', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/app/engine')>(),
  createZipEngine: () => engineFactory(),
}));

configure({ useWebWorkers: false });
registerEngineErrorTransfer();
const fixture = (name: string) => new File(
  [readFileSync(fileURLToPath(new URL(`../fixtures/zip/recover/${name}`, import.meta.url)))], name,
);
const clients: Array<ReturnType<typeof __createZipEngineForEndpoint>> = [];
afterEach(() => { for (const client of clients.splice(0)) client.terminate(); });
function connect() {
  const { port1, port2 } = new MessageChannel();
  expose(workerApi, port2 as unknown as Endpoint);
  const endpoint = Object.assign(port1, { terminate: () => { port1.close(); port2.close(); } });
  const client = __createZipEngineForEndpoint(endpoint as never, new EventTarget() as never);
  clients.push(client);
  return client;
}

const hello = 'Hello, world! This line repeats so DEFLATE has something to chew on.\n'.repeat(40);

describe('ZIP extraction CRC', () => {
  it('lists damaged input but rejects the broken file and the complete extraction', async () => {
    const input = fixture('crc-broken.zip');
    const before = new Uint8Array(await input.arrayBuffer());
    expect((await listEntries(input)).map(entry => entry.name)).toEqual(['intact.txt', 'broken.txt', 'also-ok.csv']);
    await expect(extractEntry(input, 'broken.txt')).rejects.toMatchObject({ name: 'EngineError', code: 'corrupt-entry' });
    const progress: number[] = [];
    await expect(extractAll(input, done => { progress.push(done); })).rejects.toMatchObject({ code: 'corrupt-entry' });
    expect(progress).toEqual([1]);
    expect(new Uint8Array(await input.arrayBuffer())).toEqual(before);
  });

  it('returns intact files and healthy archives with matching contents', async () => {
    const damaged = fixture('crc-broken.zip');
    for (const name of ['intact.txt', 'also-ok.csv']) {
      const blob = await extractEntry(damaged, name);
      expect(blob.size).toBeGreaterThan(0);
    }
    const good = fixture('good.zip');
    expect(await (await extractEntry(good, 'hello.txt')).text()).toBe(hello);
    const all = await extractAll(good);
    expect(all.map(entry => entry.name)).toEqual(['hello.txt', 'data.csv', 'notes/todo.md']);
    for (const entry of all) {
      expect(await entry.blob.text()).toBe(await (await extractEntry(good, entry.name)).text());
    }
    expect(await all[0].blob.text()).toBe(hello);
  });

  it('keeps the error code across a real MessageChannel and displays both translations', async () => {
    const client = connect();
    const input = fixture('crc-broken.zip');
    for (const call of [client.extractEntry(input, 'broken.txt'), client.extractAll(input)]) {
      try { await call; throw new Error('Expected extraction failure'); }
      catch (error) {
        expect(error).toBeInstanceOf(EngineError);
        expect(error).toMatchObject({ code: 'corrupt-entry' });
        for (const locale of ['ja', 'en'] as const) {
          expect(failureText({ kind: 'engine', code: 'corrupt-entry', message: '' }, ui[locale].workbench, 'job'))
            .toBe(ui[locale].workbench['corrupt-entry']);
        }
      }
    }
  });

  it.each(['one', 'all'] as const)('keeps earlier results but adds no result or success log after %s fails', async mode => {
    engineFactory = connect;
    const input = fixture('crc-broken.zip');
    let state: Session = initialSession();
    const controller = new WorkbenchController(action => { state = sessionReducer(state, action); });
    await controller.accept([input], state);
    expect(state.listing.status).toBe('ready');
    controller.dispatch({ type: 'op/select', op: 'extract' });
    controller.dispatch({ type: 'op/input', op: 'extract', input: { mode: 'one', name: 'intact.txt' } });
    await controller.run(state);
    expect(state.results).toHaveLength(1);
    expect(state.log).toHaveLength(1);
    controller.dispatch({ type: 'op/input', op: 'extract', input: mode === 'one' ? { mode, name: 'broken.txt' } : { mode } });
    await controller.run(state);
    expect(state.job.status).toBe('failed');
    if (state.job.status !== 'failed') throw new Error('Expected failed job');
    expect(state.job.failure).toMatchObject({ kind: 'engine', code: 'corrupt-entry' });
    for (const locale of ['ja', 'en'] as const) {
      expect(failureText(state.job.failure, ui[locale].workbench, 'job')).toBe(ui[locale].workbench['corrupt-entry']);
    }
    expect(state.results).toHaveLength(1);
    expect(state.log).toHaveLength(1);
    controller.dispose();
  });
});
