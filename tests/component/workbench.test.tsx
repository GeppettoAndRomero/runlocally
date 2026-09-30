import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { menuName } from './_menu';

const mock = vi.hoisted(() => ({ list: vi.fn(), one: vi.fn(), all: vi.fn(), terminate: vi.fn(), open: vi.fn(), download: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, extractEntry: mock.one, extractAll: mock.all, terminate: mock.terminate }), openArchive: mock.open }));
vi.mock('../../src/app/download', () => ({ downloadBlob: mock.download }));
const zipEntry = (name: string, extra = {}) => ({ name, directory: false, size: 1, compressedSize: 1, encrypted: false, utf8: true, ...extra });
function zipFile(name = 'source.zip'): File {
  const file = new File(['PK\x03\x04'], name);
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return file;
}
async function choose(file: File): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Choose an archive|アーカイブを選択/), { target: { files: [file] } });
  await waitFor(() => expect(mock.list).toHaveBeenCalled());
}
beforeEach(() => { mock.list.mockResolvedValue([]); mock.one.mockResolvedValue(new Blob(['one'])); mock.all.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Workbench', () => {
  it.each(['ja', 'en'] as const)('mounts %s with ready and drop acknowledgement', async locale => {
    const acknowledged = vi.fn(); window.addEventListener('filesProcessed', acknowledged);
    const view = render(<Workbench locale={locale} />);
    expect(window.__toolReady).toBe(true);
    window.dispatchEvent(new CustomEvent('filesDropped', { detail: [zipFile()] }));
    await waitFor(() => expect(acknowledged).toHaveBeenCalledTimes(1));
    expect(mock.list).toHaveBeenCalledTimes(1);
    view.unmount(); expect(window.__toolReady).toBe(false);
    window.removeEventListener('filesProcessed', acknowledged);
  });
  it.each([0, 500, 501, 1001])('shows real counts and pages %i entries', async count => {
    mock.list.mockResolvedValue(Array.from({ length: count }, (_, i) => zipEntry(`item-${i}.txt`)));
    render(<Workbench locale="en" />); await choose(zipFile());
    await waitFor(() => expect(screen.getByText(new RegExp(`Total entries: ${count}`))).toBeTruthy());
    expect(within(screen.getByRole('list')).queryAllByRole('listitem')).toHaveLength(Math.min(500, count));
    if (count > 500) {
      fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
      expect(within(screen.getByRole('list')).queryAllByRole('listitem')).toHaveLength(Math.min(500, count - 500));
      expect(screen.getByText('item-500.txt')).toBeTruthy();
    }
  });
  it('extracts, saves and reinputs a result without automatic download', async () => {
    mock.list.mockResolvedValue([zipEntry('inner.zip')]);
    render(<Workbench locale="en" />); await choose(zipFile());
    await waitFor(() => expect(screen.getAllByText('inner.zip')[0]).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
    fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
    await waitFor(() => expect(screen.getByText('0 files')).toBeTruthy());
    expect(mock.download).not.toHaveBeenCalled();
    const resultBlob = new Blob(['plain text']);
    vi.spyOn(resultBlob, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([1]).buffer } as Blob);
    mock.all.mockResolvedValue([{ name: 'inner.zip', blob: resultBlob }]);
    fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
    await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save file: inner.zip' }));
    expect(mock.download).toHaveBeenCalledWith(expect.any(Blob), 'inner.zip');
    vi.spyOn(File.prototype, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([1]).buffer } as Blob);
    fireEvent.click(screen.getByRole('button', { name: 'Use as next input: inner.zip' }));
    await waitFor(() => expect(screen.getByText(/Format could not be identified/)).toBeTruthy());
    expect(screen.getByText('1 files')).toBeTruthy();
  });
  it('shows duplicate and encrypted restrictions and excludes ineligible one-entry controls', async () => {
    mock.list.mockResolvedValue([zipEntry('same.txt'), zipEntry('same.txt'), zipEntry('secret.txt', { encrypted: true }), zipEntry('folder/', { directory: true })]);
    render(<Workbench locale="en" />); await choose(zipFile());
    await waitFor(() => expect(screen.getByText(/Total entries: 4/)).toBeTruthy());
    expect(screen.getByText(/first match/)).toBeTruthy();
    expect(within(screen.getByRole('list')).getAllByRole('button', { name: /Select for extraction:/ })).toHaveLength(2);
  });
});

describe('extraction controls', () => {
  it('extracts all entries across pages and identifies the result source and file actions', async () => {
    const entries = Array.from({ length: 501 }, (_, i) => zipEntry(`item-${i}.txt`));
    mock.list.mockResolvedValue(entries);
    mock.all.mockResolvedValue(entries.map(entry => ({ name: entry.name, blob: new Blob([entry.name]) })));
    render(<Workbench locale="en" />); await choose(zipFile('many.zip'));
    await waitFor(() => expect(screen.getByText(/Total entries: 501/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'extract') }));
    fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
    await waitFor(() => expect(screen.getByText('501 files')).toBeTruthy());
    expect(mock.all).toHaveBeenCalledTimes(1);
    expect(mock.all).toHaveBeenCalledWith(expect.any(File), expect.any(Function));
    expect(screen.getByText(/Source file: many.zip/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save file: item-500.txt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use as next input: item-500.txt' })).toBeTruthy();
  });
  it('moves focus from a row choice to the extract tab', async () => {
    mock.list.mockResolvedValue([zipEntry('chosen.txt')]);
    render(<Workbench locale="en" />); await choose(zipFile());
    const choice = await screen.findByRole('button', { name: /Select for extraction:/ });
    choice.focus(); fireEvent.click(choice);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: menuName('en', 'extract') }));
    expect((screen.getByRole('combobox', { name: 'One' }) as HTMLSelectElement).value).toBe('chosen.txt');
  });
  it('extracts one ZIP entry through the worker and saves it by name', async () => {
    mock.list.mockResolvedValue([zipEntry('first.txt'), zipEntry('docs/chosen.txt')]);
    const blob = new Blob(['chosen']);
    mock.one.mockResolvedValue(blob);
    render(<Workbench locale="en" />); await choose(zipFile('pick.zip'));
    const choices = await screen.findAllByRole('button', { name: /Select for extraction:/ });
    fireEvent.click(choices[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
    await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
    expect(mock.one).toHaveBeenCalledTimes(1);
    expect(mock.one).toHaveBeenCalledWith(expect.any(File), 'docs/chosen.txt');
    expect(mock.all).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save file: docs/chosen.txt' }));
    expect(mock.download).toHaveBeenCalledWith(blob, expect.stringMatching(/chosen\.txt$/));
  });
});
