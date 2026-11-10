import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { initialSession } from '../../src/app/state/reducer';
import type { CreateState, Session } from '../../src/app/state/session';

const mock = vi.hoisted(() => ({ seed: undefined as Session | undefined, list: vi.fn() }));
vi.mock('../../src/app/state/reducer', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/app/state/reducer')>();
  return { ...actual, initialSession: (...args: Parameters<typeof actual.initialSession>) => mock.seed ?? actual.initialSession(...args) };
});
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, terminate: vi.fn() }) }));

const item = new File(['text'], 'item.txt');
const kept: NonNullable<CreateState['result']> = { sourceFiles: [item], blob: new Blob(['zip']), name: 'created.zip', count: 1 };
function archive(): File {
  const value = new File(['zip'], 'other.zip');
  vi.spyOn(value, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return value;
}
afterEach(() => {
  cleanup();
  mock.seed = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-session');
  window.history.replaceState(null, '', '/');
});

it('keeps an unsaved created.zip, with its Save control, when an archive is opened from another operation', async () => {
  mock.list.mockResolvedValue([]);
  mock.seed = { ...initialSession(), create: { input: [item], run: { status: 'succeeded' }, result: kept } };
  render(<Workbench locale="en" page="browse" op="browse" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [archive()] } });
  await waitFor(() => expect(document.documentElement.dataset.session).toBe('open'));
  await waitFor(() => expect(mock.list).toHaveBeenCalled());
  fireEvent.click(document.getElementById('tab-create')!);
  const panel = document.getElementById('panel-create')!;
  expect(panel.textContent).toContain('created.zip');
  expect(panel.querySelector('button[aria-label="Save ZIP: created.zip"]')).not.toBeNull();
});

it('still clears the created.zip with Reset', async () => {
  mock.list.mockResolvedValue([]);
  mock.seed = { ...initialSession(), create: { input: [item], run: { status: 'succeeded' }, result: kept } };
  render(<Workbench locale="en" page="browse" op="browse" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [archive()] } });
  await waitFor(() => expect(document.documentElement.dataset.session).toBe('open'));
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(document.documentElement.dataset.session).toBeUndefined());
  fireEvent.click(document.getElementById('tab-create')!);
  expect(document.getElementById('panel-create')!.textContent).not.toContain('created.zip');
});
