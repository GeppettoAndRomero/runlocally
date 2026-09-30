import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { EngineError } from '../../src/engine/errors';
import { Workbench } from '../../src/app/Workbench';
import { ui } from '../../src/i18n/ui';
import { menuName } from './_menu';

const mock = vi.hoisted(() => ({ list: vi.fn(), rewrite: vi.fn(), all: vi.fn(), one: vi.fn(), terminate: vi.fn(), download: vi.fn(), open: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, rewriteZip: mock.rewrite, extractAll: mock.all, extractEntry: mock.one, terminate: mock.terminate }), openArchive: mock.open }));
vi.mock('../../src/app/download', () => ({ downloadBlob: mock.download }));
const entry = (name: string, more = {}) => ({ name, size: 1, compressedSize: 1, directory: false, encrypted: false, utf8: true, ...more });
function source(name = 'source.ZIP') {
  const file = new File(['zip'], name);
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return file;
}
async function choose(file = source()) {
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file] } });
  expect(screen.getByRole('tab', { name: menuName('en', 'remove') })).toBeTruthy();
  await screen.findByText(new RegExp(`^${ui.en.workbench.entries}: `));
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('removes unchecked entries, uses actual counts and shares the derived name for save and reinput', async () => {
  mock.list.mockResolvedValue([entry('keep.txt'), entry('remove.txt'), entry('folder/', { directory: true })]);
  const blob = new Blob(['result']);
  mock.rewrite.mockResolvedValue({ blob, total: 3, kept: 2, removed: 1, renamed: 0, encryptedCount: 0 });
  render(<Workbench locale="en" />); await choose();
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'remove') }));
  expect((screen.getByRole('checkbox', { name: 'keep.txt: Keep' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'remove.txt: Keep' }));
  fireEvent.click(screen.getByRole('button', { name: /^Create new ZIP:/ }));
  await screen.findByRole('button', { name: 'Save file: source-trimmed.zip' });
  const options = mock.rewrite.mock.calls[0][1];
  expect(options.keep('keep.txt')).toBe(true);
  expect(options.keep('remove.txt')).toBe(false);
  expect(options.rename).toBeUndefined();
  expect(screen.getByText(/Excluded 1 entries/)).toBeTruthy();
  expect(mock.download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save file: source-trimmed.zip' }));
  expect(mock.download).toHaveBeenCalledWith(blob, 'source-trimmed.zip');
  vi.spyOn(File.prototype, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  fireEvent.click(screen.getByRole('button', { name: 'Use as next input: source-trimmed.zip' }));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  expect(screen.getAllByText('source-trimmed.zip')[0]).toBeTruthy();
});

it('blocks zero exclusions, zero kept files, and keeps selection across pages', async () => {
  mock.list.mockResolvedValue(Array.from({ length: 501 }, (_, i) => entry(`item-${i}.txt`)));
  render(<Workbench locale="en" />); await choose();
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'remove') }));
  expect((screen.getByRole('button', { name: /^Create new ZIP:/ }) as HTMLButtonElement).disabled).toBe(true);
  const list = screen.getByRole('list', { name: 'Remove' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(500);
  fireEvent.click(screen.getByRole('checkbox', { name: 'item-0.txt: Keep' }));
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Remove Page' })).getByRole('button', { name: /^Next:/ }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText(/Planned exclusions: 1 entries/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Exclude all entries in the current input:/ }));
  expect((screen.getByRole('button', { name: /^Create new ZIP:/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Keep at least one file.')).toBeTruthy();
  expect(mock.rewrite).not.toHaveBeenCalled();
});

it('matches directory keep state and rewritten entries for all children, directory, and partial exclusions', async () => {
  mock.list.mockResolvedValue([entry('folder/', { directory: true }), entry('folder/a.txt'), entry('folder/b.txt'), entry('outside.txt')]);
  mock.rewrite.mockResolvedValue({ blob: new Blob(['zip']), total: 4, kept: 2, removed: 2, renamed: 0, encryptedCount: 0 });
  render(<Workbench locale="en" />); await choose();
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'remove') }));
  const folder = screen.getByRole('checkbox', { name: 'folder/: Keep' }) as HTMLInputElement;
  const a = screen.getByRole('checkbox', { name: 'folder/a.txt: Keep' });
  const b = screen.getByRole('checkbox', { name: 'folder/b.txt: Keep' });
  const run = screen.getByRole('button', { name: /^Create new ZIP:/ });
  expect(folder.checked).toBe(true);

  fireEvent.click(a);
  fireEvent.click(b);
  expect(folder.checked).toBe(false);
  expect(folder.indeterminate).toBe(true);
  expect(screen.getByText(/Planned exclusions: 2 entries/)).toBeTruthy();
  fireEvent.click(run);
  await waitFor(() => expect(mock.rewrite).toHaveBeenCalledTimes(1));
  expect(mock.rewrite.mock.calls[0][1].keep('folder/')).toBe(true);
  expect(mock.rewrite.mock.calls[0][1].keep('folder/a.txt')).toBe(false);
  expect(mock.rewrite.mock.calls[0][1].keep('folder/b.txt')).toBe(false);

  await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /^Keep all entries in the current input:/ }));
  fireEvent.click(folder);
  expect(folder.checked).toBe(false);
  expect(folder.indeterminate).toBe(false);
  expect(screen.getByText(/Planned exclusions: 3 entries/)).toBeTruthy();
  fireEvent.click(run);
  await waitFor(() => expect(mock.rewrite).toHaveBeenCalledTimes(2));
  for (const name of ['folder/', 'folder/a.txt', 'folder/b.txt']) expect(mock.rewrite.mock.calls[1][1].keep(name)).toBe(false);

  await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /^Keep all entries in the current input:/ }));
  fireEvent.click(a);
  expect(folder.checked).toBe(false);
  expect(folder.indeterminate).toBe(true);
  expect(screen.getByText(/Planned exclusions: 1 entries/)).toBeTruthy();
  fireEvent.click(run);
  await waitFor(() => expect(mock.rewrite).toHaveBeenCalledTimes(3));
  expect(mock.rewrite.mock.calls[2][1].keep('folder/')).toBe(true);
  expect(mock.rewrite.mock.calls[2][1].keep('folder/a.txt')).toBe(false);
  expect(mock.rewrite.mock.calls[2][1].keep('folder/b.txt')).toBe(true);
});

it('labels the keep choice and bulk result in Japanese', async () => {
  mock.list.mockResolvedValue([entry('残す.txt'), entry('外す.txt')]);
  render(<Workbench locale="ja" />);
  fireEvent.change(screen.getByLabelText('アーカイブを選択'), { target: { files: [source()] } });
  expect(screen.getByRole('tab', { name: menuName('ja', 'remove') })).toBeTruthy();
  await screen.findByText(new RegExp(`^${ui.ja.workbench.entries}: `));
  fireEvent.click(screen.getByRole('tab', { name: menuName('ja', 'remove') }));
  expect((screen.getByRole('checkbox', { name: '残す.txt: 残す' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /^現在の入力のすべての項目を除外対象にする:/ }));
  expect((screen.getByRole('checkbox', { name: '残す.txt: 残す' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^現在の入力のすべての項目を残す:/ }));
  expect((screen.getByRole('checkbox', { name: '残す.txt: 残す' }) as HTMLInputElement).checked).toBe(true);
});

it('previews bytes, rejects a new collision, and uses entry metadata for rename', async () => {
  const bytes = new Uint8Array([0x83, 0x81, 0x83, 0x82, 0x92, 0xa0, 0x2e, 0x74, 0x78, 0x74]);
  mock.list.mockResolvedValue([entry('garbled.txt', { name: 'ƒƒ‚’ .txt', utf8: false, rawFilename: bytes }), entry('plain.txt')]);
  mock.rewrite.mockResolvedValue({ blob: new Blob(['zip']), total: 2, kept: 2, removed: 0, renamed: 1, encryptedCount: 0 });
  render(<Workbench locale="en" />); await choose();
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'fix-names') }));
  const preview = screen.getByRole('list', { name: 'Repair names' });
  expect(within(preview).getByText(/Candidate:/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Repair names into a new ZIP:/ }));
  await screen.findByRole('button', { name: 'Save file: source-fixed.zip' });
  const options = mock.rewrite.mock.calls[0][1];
  expect(options.keep).toBeUndefined();
  expect(options.rename('', { name: 'plain.txt', utf8: true })).toBe('plain.txt');
  expect(options.rename('', { name: 'ƒƒ‚’ .txt', utf8: false, rawFilename: bytes })).not.toBe('ƒƒ‚’ .txt');
  expect(screen.getByText(/Repaired 1 entries/)).toBeTruthy();
});

it('keeps prior results after an encrypted rewrite failure and permits selection change', async () => {
  mock.list.mockResolvedValue([entry('plain.txt'), entry('secret.txt', { encrypted: true })]);
  mock.rewrite.mockRejectedValueOnce(new EngineError('encrypted-entry')).mockResolvedValueOnce({ blob: new Blob(['zip']), total: 2, kept: 1, removed: 1, renamed: 0, encryptedCount: 1 });
  render(<Workbench locale="en" />); await choose();
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'remove') }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'plain.txt: Keep' }));
  fireEvent.click(screen.getByRole('button', { name: /^Create new ZIP:/ }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Encrypted entries are selected to remain'));
  expect(screen.queryByRole('button', { name: 'Save file: source-trimmed.zip' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'plain.txt: Keep' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'secret.txt: Keep' }));
  fireEvent.click(screen.getByRole('button', { name: /^Create new ZIP:/ }));
  await screen.findByRole('button', { name: 'Save file: source-trimmed.zip' });
  expect(mock.rewrite).toHaveBeenCalledTimes(2);
});

it('retries a failed ZIP listing with the same input and no job while it is failed', async () => {
  mock.list.mockRejectedValueOnce(new EngineError('bad-central')).mockResolvedValueOnce([entry('ok.txt')]);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [source()] } });
  await screen.findByRole('button', { name: /^Retry listing:/ });
  const alert = screen.getByRole('alert').textContent ?? '';
  expect(alert).toContain('ZIP signature');
  expect(alert).toContain('Could not read the ZIP directory information.');
  expect(alert).not.toContain('could not be listed');
  expect(alert.match(/Could not read/g)).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  expect(screen.queryByRole('button', { name: /^Extract:/ })).toBeNull();
  expect(mock.all).not.toHaveBeenCalled();
  expect(mock.one).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Retry listing:/ }));
  await screen.findByRole('button', { name: /^Extract:/ });
  expect(within(document.getElementById('panel-browse')!).getByText('ok.txt')).toBeTruthy();
  expect((screen.getByRole('button', { name: /^Extract:/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(mock.list.mock.calls[0][0]).toBe(mock.list.mock.calls[1][0]);
});

it('explains unreadable ZIP listing once in Japanese before the recovery guidance', async () => {
  mock.list.mockRejectedValue(new EngineError('bad-central'));
  render(<Workbench locale="ja" />);
  fireEvent.change(screen.getByLabelText('アーカイブを選択'), { target: { files: [source()] } });
  await screen.findByRole('button', { name: /^一覧を再試行:/ });
  const alert = screen.getByRole('alert').textContent ?? '';
  expect(alert).toContain('ZIP の一覧情報を読み取れませんでした。');
  expect(alert.match(/読み取れませんでした/g)).toHaveLength(1);
  expect(alert).toContain('内容を救出する機能は今後追加予定です。');
});

it('retries an archive listing before exposing extraction and never offers rewrite', async () => {
  mock.open.mockRejectedValueOnce(new EngineError('unsupported')).mockResolvedValueOnce({ entries: [{ path: 'ok.txt', size: 1 }], close: vi.fn() });
  const file = new File(['rar'], 'source.rar');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([82, 97, 114, 33, 26, 7, 0]).buffer } as Blob);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file] } });
  await screen.findByRole('button', { name: /^Retry listing:/ });
  expect(screen.getByRole('alert').textContent).toContain('RAR/7z extraction');
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  expect(screen.queryByRole('button', { name: /^Extract:/ })).toBeNull();
  expect(mock.open).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /^Retry listing:/ }));
  await screen.findByRole('button', { name: /^Extract:/ });
  expect(within(document.getElementById('panel-browse')!).getByText('ok.txt')).toBeTruthy();
  expect((screen.getByRole('button', { name: /^Extract:/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('tab', { name: menuName('en', 'remove') })).toBeNull();
  expect(mock.open.mock.calls[0][0]).toBe(mock.open.mock.calls[1][0]);
});

it('moves focus among four ZIP tabs with arrow keys', async () => {
  mock.list.mockResolvedValue([entry('a.txt')]);
  render(<Workbench locale="en" />); await choose();
  const browse = screen.getByRole('tab', { name: menuName('en', 'browse') });
  browse.focus();
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: menuName('en', 'extract') }));
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: menuName('en', 'remove') }));
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: menuName('en', 'fix-names') }));
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(browse);
});

it('shows a new repair-name collision and blocks rewriting', async () => {
  const rawFilename = new Uint8Array([0x83,0x81,0x83,0x82,0x92,0xa0,0x2e,0x74,0x78,0x74]);
  mock.list.mockResolvedValue([entry('ƒƒ‚’ .txt', { utf8: false, rawFilename }), entry('メモ帳.txt')]);
  render(<Workbench locale="en" />); await choose();
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'fix-names') }));
  expect(screen.getByRole('alert').textContent).toContain('メモ帳.txt');
  expect((screen.getByRole('button', { name: /^Repair names into a new ZIP:/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(mock.rewrite).not.toHaveBeenCalled();
});
