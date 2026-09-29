import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';

const mock = vi.hoisted(() => ({ list: vi.fn(), terminate: vi.fn(), all: vi.fn(), one: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, extractAll: mock.all, extractEntry: mock.one, terminate: mock.terminate }) }));
function archive(name = 'source.zip') {
  const file = new File(['zip'], name);
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return file;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('connects the native label, instructions and input; shows empty results and useful Reset', async () => {
  mock.list.mockResolvedValue([]);
  render(<Workbench locale="en" />);
  const input = screen.getByLabelText('Choose an archive') as HTMLInputElement;
  const picker = input.closest('label');
  expect(picker?.classList.contains('workbench__picker')).toBe(true);
  expect(input.labels?.[0]).toBe(picker);
  expect(picker?.contains(input)).toBe(true);
  expect(input.getAttribute('aria-describedby')).toBe('workbench-drop-hint');
  expect(document.getElementById('workbench-drop-hint')?.textContent).toContain('Drag one archive');
  expect(screen.getByText('Choose an archive and run an operation to see results here.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Reset:/ })).toBeNull();
  fireEvent.change(input, { target: { files: [archive('a-very-long-source-name.zip')] } });
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reset: a-very-long-source-name.zip' })).toBeTruthy());
  expect(screen.getByText('a-very-long-source-name.zip', { exact: true }).classList.contains('workbench__filename')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Reset:/ })).toBeNull());
});
it('shows the input error as an alert and allows Reset before a source exists', async () => {
  render(<Workbench locale="en" />);
  window.dispatchEvent(new CustomEvent('filesDropped', { detail: [archive(), archive()] }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Choose one archive.'));
  expect(screen.getByRole('button', { name: 'Reset: Input' })).toBeTruthy();
});
