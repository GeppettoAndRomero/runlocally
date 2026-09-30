import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { ui } from '../../src/i18n/ui';
import { menuName } from './_menu';

const mock = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, terminate: vi.fn() }), openArchive: mock.open }));
const entry = (name: string, directory = false) => ({ name, size: 7, compressedSize: 7, directory, encrypted: false, utf8: true });
async function load() {
  const file = new File(['zip'], 'sample.zip');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file] } });
  expect(screen.getByRole('tab', { name: menuName('en', 'remove') })).toBeTruthy();
  await screen.findByText(new RegExp(`^${ui.en.workbench.entries}: `));
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps tab state, focus cycling, names, size, and native selection states', async () => {
  mock.list.mockResolvedValue([entry('folder/', true), entry('folder/long-name.txt')]);
  render(<Workbench locale="en" />);
  await load();
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map(tab => tab.id)).toEqual(['tab-browse', 'tab-extract', 'tab-remove', 'tab-fix-names']);
  for (const tab of tabs) {
    expect(tab.getAttribute('aria-controls')).toBe('panel-' + tab.id.slice(4));
    expect(document.getElementById(tab.getAttribute('aria-controls')!)?.hidden).toBe(tab !== tabs[0]);
  }
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  expect(tabs[0].tabIndex).toBe(0);
  expect(tabs[1].tabIndex).toBe(-1);
  const browse = document.getElementById('panel-browse')!;
  const row = within(browse).getAllByRole('listitem')[1];
  expect(within(row).getByText('folder/long-name.txt').classList.contains('workbench__name')).toBe(true);
  expect(within(row).getByText('7 B').classList.contains('workbench__size')).toBe(true);
  expect(row.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(tabs[3]);
  expect(tabs[3].getAttribute('aria-selected')).toBe('true');
  expect(document.getElementById('panel-browse')?.hidden).toBe(true);
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(tabs[0]);
  fireEvent.click(tabs[2]);
  const folder = screen.getByRole('checkbox', { name: 'folder/: Keep' }) as HTMLInputElement;
  expect(folder.checked).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'folder/long-name.txt: Keep' }));
  expect(folder.indeterminate).toBe(true);
  expect(folder.closest('[data-keep-state]')?.getAttribute('data-keep-state')).toBe('indeterminate');
  folder.focus();
  fireEvent.keyDown(folder, { key: ' ' });
  fireEvent.click(folder);
  expect(folder.checked).toBe(true);
});

it('keeps two available tabs for a non-ZIP archive', async () => {
  mock.open.mockResolvedValue({ entries: [{ path: 'note.txt', size: 7 }], close: vi.fn() });
  const file = new File(['rar'], 'sample.7z');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([55, 122, 188, 175, 39, 28]).buffer } as Blob);
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file] } });
  expect(screen.getByRole('tab', { name: menuName('en', 'extract') })).toBeTruthy();
  await screen.findByText('note.txt');
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: menuName('en', 'extract') }));
});
