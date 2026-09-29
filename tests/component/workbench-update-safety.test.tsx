import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench, isWorkbenchUpdateSafe } from '../../src/app/Workbench';
import { WorkbenchController } from '../../src/app/workbench-controller';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import { applyUpdate, registerSW } from '../../src/app/registerSW';
import type { Session } from '../../src/app/state/session';
import type { ZipEntry } from '../../src/engine/types';

const mock = vi.hoisted(() => ({ list: vi.fn(), extractAll: vi.fn(), terminate: vi.fn(), download: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, extractAll: mock.extractAll, terminate: mock.terminate }) }));
vi.mock('../../src/app/download', () => ({ downloadBlob: mock.download }));

class Channel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
}
function setupUpdate() {
  const worker = { postMessage: vi.fn() };
  const registration = Object.assign(new EventTarget(), { scope: `${location.origin}/`, active: {}, waiting: worker });
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: {}, getRegistrations: vi.fn(async () => []), register: vi.fn(async () => registration),
  });
  let held = 0;
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    query: async () => ({ held: held ? [{ name: 'runlocally-pwa-tabs' }] : [], pending: [] }),
    request: async (_name: string, _options: object, callback: (lock: object) => Promise<void>) => {
      held++;
      try { await callback({}); } finally { held--; }
    },
  } });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('BroadcastChannel', Channel);
  vi.stubGlobal('caches', { keys: async () => [], delete: vi.fn() });
  return { worker, serviceWorker };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function zipFile(read: Promise<ArrayBuffer>) {
  const file = new File(['PK\x03\x04'], 'source.zip');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: () => read } as Blob);
  return file;
}
const header = Uint8Array.from([80, 75, 3, 4]).buffer;

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('blocks update while the file header and listing are pending, then while work remains', async () => {
  const env = setupUpdate();
  const read = deferred<ArrayBuffer>();
  const listing = deferred<ZipEntry[]>();
  mock.list.mockReturnValue(listing.promise);
  await registerSW();
  render(<Workbench locale="en" />);
  const update = await screen.findByRole('button', { name: 'Update' });
  await waitFor(() => expect(update).not.toHaveProperty('disabled', true));
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [zipFile(read.promise)] } });
  await waitFor(() => expect(update).toHaveProperty('disabled', true));
  update.click();
  expect(env.worker.postMessage).not.toHaveBeenCalled();
  read.resolve(header);
  await waitFor(() => expect(mock.list).toHaveBeenCalledOnce());
  expect(update).toHaveProperty('disabled', true);
  listing.resolve([{ name: 'part.txt', directory: false, size: 1, compressedSize: 1, encrypted: false, utf8: true }]);
  await waitFor(() => expect(screen.getByText(/Total entries: 1/)).toBeTruthy());
  expect(update).toHaveProperty('disabled', true);
  mock.extractAll.mockResolvedValue([{ name: 'part.txt', blob: new Blob(['saved']) }]);
  fireEvent.click(screen.getByRole('tab', { name: 'Extract' }));
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save file: part.txt' })).toBeTruthy());
  expect(update).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Save file: part.txt' }));
  expect(mock.download).toHaveBeenCalledOnce();
  expect(update).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(update).not.toHaveProperty('disabled', true));
  const nextRead = deferred<ArrayBuffer>();
  const nextListing = deferred<ZipEntry[]>();
  mock.list.mockReturnValue(nextListing.promise);
  let session: Session = initialSession();
  const controller = new WorkbenchController(action => { session = sessionReducer(session, action); });
  const safe = () => isWorkbenchUpdateSafe(session, controller);
  expect(safe()).toBe(true);
  const accepting = controller.accept([zipFile(nextRead.promise)], session);
  expect(session.source).toBeNull();
  expect(safe()).toBe(false);
  expect(await applyUpdate(safe)).toBe(false);
  expect(env.worker.postMessage).not.toHaveBeenCalled();
  nextRead.resolve(header);
  await waitFor(() => expect(session.listing.status).toBe('reading'));
  expect(safe()).toBe(false);
  expect(await applyUpdate(safe)).toBe(false);
  nextListing.resolve([]);
  await accepting;
  expect(session.listing.status).toBe('ready');
  expect(safe()).toBe(false);
  session = { ...session, results: [{ id: 'result', op: 'extract', sourceFile: session.source!.file,
    sourceChain: [], files: [], actual: { kind: 'extract', files: 0 } }] };
  expect(safe()).toBe(false);
  controller.reset();
  expect(safe()).toBe(true);
  expect(await applyUpdate(safe)).toBe(true);
  session = sessionReducer(session, { type: 'input/accept', file: new File(['x'], 'new.zip'), kind: 'zip' });
  expect(safe()).toBe(false);
  const reloadError = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(env.serviceWorker, { controller: {} });
  env.serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reloadError).not.toHaveBeenCalled();
  controller.dispose();
});
