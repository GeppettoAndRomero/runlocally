import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { menuName } from './_menu';

const mock = vi.hoisted(() => ({ list: vi.fn(), all: vi.fn(), one: vi.fn(), terminate: vi.fn(), open: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, extractAll: mock.all, extractEntry: mock.one, terminate: mock.terminate }), openArchive: mock.open }));
vi.mock('../../src/app/download', () => ({ downloadBlob: vi.fn() }));
function file(): File {
  const value = new File(['zip'], 'source.zip');
  vi.spyOn(value, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return value;
}
const entry = { name: 'a.txt', size: 1, compressedSize: 1, directory: false, encrypted: false, utf8: true };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('retains listing and result through failure, then allows retry without duplicate starts', async () => {
  mock.list.mockResolvedValue([entry]);
  mock.all.mockResolvedValueOnce([{ name: 'a.txt', blob: new Blob(['ok']) }]).mockRejectedValueOnce(Error('failed')).mockResolvedValueOnce([]);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file()] } });
  await waitFor(() => expect(screen.getByText(/Total entries: 1/)).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText(/The operation failed/)).toBeTruthy());
  expect(screen.getByText('1 files')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText('0 files')).toBeTruthy());
  expect(mock.all).toHaveBeenCalledTimes(3);
  expect(mock.terminate).toHaveBeenCalled();
});
it('rejects multiple files and oversized input before reading', async () => {
  render(<Workbench locale="en" />);
  const first = file(); const second = file();
  window.dispatchEvent(new CustomEvent('filesDropped', { detail: [first, second] }));
  await waitFor(() => expect(screen.getByText('Choose one archive.')).toBeTruthy());
  const large = file(); Object.defineProperty(large, 'size', { value: 1_000_000_001 });
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [large] } });
  await waitFor(() => expect(screen.getByText('Choose an input of 1 GB (1,000,000,000 bytes) or less.')).toBeTruthy());
  expect(large.slice).not.toHaveBeenCalled(); expect(mock.list).not.toHaveBeenCalled();
});
it('closes a late archive handle after reset and does not show its listing', async () => {
  let resolve!: (value: { entries: { path: string; size: number }[]; close: () => void; extractOne: () => Promise<File>; extractAll: () => Promise<File[]> }) => void;
  mock.open.mockReturnValue(new Promise(value => { resolve = value; }));
  const source = new File(['rar'], 'source.rar');
  vi.spyOn(source, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([82, 97, 114, 33, 26, 7, 0]).buffer } as Blob);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [source] } });
  await waitFor(() => expect(mock.open).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  const close = vi.fn();
  resolve({ entries: [{ path: 'late.txt', size: 1 }], close, extractOne: vi.fn(), extractAll: vi.fn() });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('late.txt')).toBeNull();
});
it('lists and extracts an archive through a newly opened handle', async () => {
  const closeListing = vi.fn(); const closeExtraction = vi.fn();
  mock.open.mockResolvedValueOnce({ entries: [{ path: 'dir/a.txt', size: 1 }], close: closeListing })
    .mockResolvedValueOnce({ entries: [{ path: 'dir/a.txt', size: 1 }], close: closeExtraction,
      extractOne: vi.fn(), extractAll: vi.fn(async () => [new File(['a'], 'a.txt')]) });
  const source = new File(['rar'], 'source.rar');
  vi.spyOn(source, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([82, 97, 114, 33, 26, 7, 0]).buffer } as Blob);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [source] } });
  await waitFor(() => expect(screen.getByText('dir/a.txt')).toBeTruthy());
  expect(closeListing).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
  expect(mock.open).toHaveBeenCalledTimes(2);
  expect(closeExtraction).not.toHaveBeenCalled();
});
it('keeps the first result while listing a derived ZIP input', async () => {
  mock.list.mockResolvedValueOnce([entry]).mockResolvedValueOnce([{ ...entry, name: 'inside.txt' }]);
  mock.all.mockResolvedValue([{ name: 'inner.zip', blob: new Blob(['nested bytes']) }]);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file()] } });
  await waitFor(() => expect(screen.getByText(/Total entries: 1/)).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
  vi.spyOn(File.prototype, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  fireEvent.click(screen.getByRole('button', { name: 'Use as next input: inner.zip' }));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'browse') }));
  expect(screen.getAllByText('inside.txt')[0]).toBeTruthy();
  expect(screen.getByText('1 files')).toBeTruthy();
});

it('restarts intake and actions after a BFCache return', async () => {
  mock.list.mockResolvedValue([entry]);
  render(<Workbench locale="en" />);
  window.dispatchEvent(new Event('pagehide'));
  expect(window.__toolReady).toBe(false);
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  expect(window.__toolReady).toBe(true);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file()] } });
  await waitFor(() => expect(screen.getByText(/Total entries: 1/)).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  mock.all.mockResolvedValue([{ name: 'a.txt', blob: new Blob(['a']) }]);
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  expect(screen.queryByText('1 files')).toBeNull();
});

it('blocks repeated runs, ignores late progress and releases a running worker on unmount', async () => {
  mock.list.mockResolvedValue([entry]);
  let finish!: (files: { name: string; blob: Blob }[]) => void;
  let progress!: (done: number, total: number) => void;
  mock.all.mockImplementation((_file: File, notify: typeof progress) => {
    progress = notify;
    return new Promise(resolve => { finish = resolve; });
  });
  const view = render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file()] } });
  await waitFor(() => expect(screen.getByText(/Total entries: 1/)).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  const run = screen.getByRole('button', { name: /^Extract:/ });
  fireEvent.click(run); fireEvent.click(run);
  await waitFor(() => expect(mock.all).toHaveBeenCalledTimes(1));
  window.dispatchEvent(new CustomEvent('filesDropped', { detail: [file()] }));
  await waitFor(() => expect(screen.getByText('Processing. Try another input when it finishes.')).toBeTruthy());
  progress(1, 1);
  await waitFor(() => expect(screen.getByText(/Progress: 1 \/ 1/)).toBeTruthy());
  finish([{ name: 'a.txt', blob: new Blob(['ok']) }]);
  await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
  expect(screen.queryByText('Processing. Try another input when it finishes.')).toBeNull();
  progress(2, 2);
  expect(screen.queryByText(/Progress: 2 \/ 2/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(mock.all).toHaveBeenCalledTimes(2));
  view.unmount();
  expect(mock.terminate).toHaveBeenCalledTimes(3);
  finish([{ name: 'late.txt', blob: new Blob(['late']) }]);
});

it('extracts one archive entry and closes its handle', async () => {
  const closeListing = vi.fn(); const closeOne = vi.fn(); const extractOne = vi.fn(async () => new File(['a'], 'a.txt'));
  mock.open.mockResolvedValueOnce({ entries: [{ path: 'dir/a.txt', size: 1 }], close: closeListing })
    .mockResolvedValueOnce({ entries: [{ path: 'dir/a.txt', size: 1 }], close: closeOne, extractOne });
  const source = new File(['rar'], 'source.rar');
  vi.spyOn(source, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([82, 97, 114, 33, 26, 7, 0]).buffer } as Blob);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [source] } });
  const choice = await screen.findByRole('button', { name: /Select for extraction:/ });
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
  expect(extractOne).toHaveBeenCalledWith('dir/a.txt');
  expect(closeListing).toHaveBeenCalledTimes(1);
  expect(closeOne).toHaveBeenCalledTimes(1);
});
