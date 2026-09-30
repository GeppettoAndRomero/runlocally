import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { OperationMenu } from '../../src/app/OperationMenu';
import { Workbench } from '../../src/app/Workbench';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { menuUi } from '../../src/i18n/ui';
import { pagePath } from '../../src/seo/page';

const engine = vi.hoisted(() => ({ list: vi.fn(), all: vi.fn(), open: vi.fn(), terminate: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: engine.list, extractAll: engine.all, terminate: engine.terminate }), openArchive: engine.open }));
vi.mock('../../src/app/download', () => ({ downloadBlob: vi.fn() }));

const entry = { name: 'one.txt', size: 1, compressedSize: 1, directory: false, encrypted: false, utf8: true };
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; change?: () => void };
function file(bytes = [80, 75, 3, 4], name = 'source.zip') {
  const input = new File(['archive'], name);
  vi.spyOn(input, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from(bytes).buffer } as Blob);
  return input;
}
function choose(input: File) {
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [input] } });
}
function tab(id: string) { return document.getElementById(`tab-${id}`) as HTMLButtonElement; }
function selected(id: string) {
  expect(tab(id).getAttribute('aria-selected')).toBe('true');
  expect(tab(id).tabIndex).toBe(0);
  for (const op of AVAILABLE_OPS) if (op.id !== id && tab(op.id)) expect(tab(op.id).tabIndex).toBe(-1);
  expect(document.getElementById(`panel-${id}`)?.hidden).toBe(false);
}
beforeEach(() => {
  document.body.innerHTML = '<a data-chrome-page="extract" href="/en/zip/extract/"></a><a data-chrome-locale="ja" href="/zip/"></a><h1 id="page-heading"></h1><section id="page-content"></section>';
  window.history.replaceState(null, '', pagePath('en', 'top'));
  media = { matches: true, addEventListener: vi.fn((_name, listener) => { media.change = listener; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  engine.list.mockResolvedValue([entry]);
  engine.all.mockResolvedValue([{ name: 'one.txt', blob: new Blob(['ok']) }]);
  engine.open.mockResolvedValue({ entries: [{ path: 'one.txt', size: 1 }], close: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it.each(['ja', 'en'] as const)('uses %s verbs and descriptions with linked panels', locale => {
  const select = vi.fn();
  const { unmount } = render(<OperationMenu locale={locale} operations={AVAILABLE_OPS} selected="browse" onSelect={select} />);
  expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
  for (const op of AVAILABLE_OPS) {
    const button = screen.getByRole('tab', { name: menuUi[locale][op.i18nKey].verb });
    expect(button.getAttribute('aria-describedby')).toBe(`menu-description-${op.id}`);
    expect(document.getElementById(`menu-description-${op.id}`)?.textContent).toBe(menuUi[locale][op.i18nKey].description);
    expect(button.getAttribute('aria-controls')).toBe(`panel-${op.id}`);
  }
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowUp' });
  expect(select).toHaveBeenCalledWith('fix-names');
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
  expect(select).toHaveBeenLastCalledWith('extract');
  unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith('change', media.change);
});

it('shows four panels before input, cycles focus and URL, and changes orientation without history', async () => {
  render(<Workbench locale="en" />);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(document.querySelectorAll('[data-workbench-menu]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-chrome-page]')).toHaveLength(1);
  for (const op of AVAILABLE_OPS) expect(document.getElementById(`panel-${op.id}`)?.tabIndex).toBe(0);
  selected('browse');
  expect(screen.queryByRole('button', { name: /^Extract:/ })).toBeNull();
  const push = vi.spyOn(window.history, 'pushState');
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowUp' });
  selected('fix-names');
  expect(document.activeElement).toBe(tab('fix-names'));
  expect(window.location.pathname).toBe(pagePath('en', 'fix-names'));
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  selected('browse');
  media.matches = false;
  media.change?.();
  await waitFor(() => expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal'));
  const up = fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowUp', cancelable: true });
  expect(up).toBe(true);
  selected('browse');
  expect(push).toHaveBeenCalledTimes(2);
  fireEvent.click(tab('browse'));
  expect(push).toHaveBeenCalledTimes(2);
});

it('keeps the menu while listing and after failure, then resets to four choices', async () => {
  let reject!: (reason: Error) => void;
  engine.list.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  render(<Workbench locale="en" />);
  const input = file();
  choose(input);
  await waitFor(() => expect(engine.list).toHaveBeenCalledTimes(1));
  expect(engine.list.mock.calls[0][0]).toBe(input);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: /^Extract:/ })).toBeNull();
  reject(new Error('listing failed'));
  await screen.findByRole('button', { name: /^Retry listing:/ });
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: /^Extract:/ })).toBeNull();
  expect(engine.all).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  selected('browse');
});

it.each([
  ['rar', [82, 97, 114, 33, 26, 7, 0]],
  ['7z', [55, 122, 188, 175, 39, 28]],
  ['tar', [...Array(257).fill(0), 117, 115, 116, 97, 114, 0]],
] as const)('keeps Browse and Extract for %s, with two-item keyboard cycling', async (kind, bytes) => {
  window.history.replaceState(null, '', pagePath('en', 'remove'));
  render(<Workbench locale="en" page="remove" op="remove" />);
  choose(file([...bytes], `source.${kind}`));
  await waitFor(() => expect(window.location.pathname).toBe(pagePath('en', 'browse')));
  await waitFor(() => expect(engine.open).toHaveBeenCalledTimes(1));
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(document.getElementById('panel-remove')).toBeNull();
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
  selected('extract');
  expect(document.activeElement).toBe(tab('extract'));
  expect(window.location.pathname).toBe(pagePath('en', 'extract'));
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  selected('browse');
  expect(engine.list).not.toHaveBeenCalled();
});

it('restricts unknown input, corrects the URL, and preserves a ZIP File and result across route changes', async () => {
  render(<Workbench locale="en" />);
  fireEvent.click(tab('remove'));
  choose(file([0, 1, 2, 3], 'unknown.bin'));
  await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
  await waitFor(() => expect(window.location.pathname).toBe(pagePath('en', 'browse')));
  expect(engine.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  const input = file();
  choose(input);
  await waitFor(() => expect(screen.getAllByText('one.txt').length).toBeGreaterThan(0));
  expect(engine.list.mock.calls[0][0]).toBe(input);
  fireEvent.click(tab('extract'));
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await screen.findByText('1 files');
  expect(engine.all.mock.calls[0][0]).toBe(input);
  fireEvent.click(tab('browse'));
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ja' } });
  const header = document.querySelector<HTMLAnchorElement>('[data-chrome-page]')!;
  header.href = pagePath('ja', 'remove');
  fireEvent.click(header);
  selected('remove');
  window.history.replaceState(null, '', pagePath('en', 'extract'));
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => selected('extract'));
  expect(engine.list).toHaveBeenCalledTimes(1);
  expect(screen.getByText('1 files')).toBeTruthy();
});
