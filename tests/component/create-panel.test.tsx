import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { CreatePanel } from '../../src/app/panels/create.panel';
import type { PanelProps } from '../../src/app/panels';
import { initialSession, MAX_INPUT_BYTES } from '../../src/app/state/reducer';
import { createUi, ui } from '../../src/i18n/ui';

const mock = vi.hoisted(() => ({ applying: false, save: vi.fn() }));
vi.mock('../../src/app/registerSW', () => ({ isUpdateApplying: () => mock.applying }));
vi.mock('../../src/app/download', () => ({ downloadBlob: mock.save }));
afterEach(() => {
  cleanup();
  mock.applying = false;
  vi.clearAllMocks();
  delete window.__toolReady;
});
const t = createUi.en;
function setup(overrides: Partial<PanelProps> = {}) {
  let props: PanelProps = { session: initialSession(0, 'create'), locale: 'en', t: ui.en.workbench,
    active: true, busy: false, updating: false, publish: vi.fn(), onNavigate: vi.fn(), onRun: vi.fn(),
    onCreate: vi.fn(), onCreateSelectionChange: vi.fn(), ...overrides };
  const view = render(<CreatePanel {...props} />);
  return { ...view, get props() { return props; }, update(next: Partial<PanelProps>) {
    props = { ...props, ...next };
    view.rerender(<CreatePanel {...props} />);
  } };
}
function file(name: string, path = '', size = 1, lastModified = 1) {
  const value = new File(['x'], name, { lastModified });
  Object.defineProperties(value, { webkitRelativePath: { value: path }, size: { value: size } });
  return value;
}
function choose(files: File[], folder = false) {
  const input = screen.getByLabelText(folder ? t.addFolder : t.addFiles);
  fireEvent.change(input, { target: { files } });
  expect(input).toHaveProperty('value', '');
}
function drop(files: File[]) { fireEvent(window, new CustomEvent('filesDropped', { detail: files })); }
function run() { return screen.getByRole('button', { name: t.run }); }
function clear() { fireEvent.click(screen.getByRole('button', { name: t.clearSelection })); }

it('accumulates files, folders and drops without running, preserving identities, paths and first order', () => {
  const view = setup();
  window.__toolReady = true;
  const processed = vi.fn();
  window.addEventListener('filesProcessed', processed);
  try {
    expect(screen.getByLabelText(t.addFiles)).toHaveProperty('multiple', true);
    expect(screen.getByLabelText(t.addFolder).hasAttribute('webkitdirectory')).toBe(true);
    expect(screen.getByText(t.emptyGuide)).toBeTruthy();
    expect(screen.getByText(t.emptySelection)).toBeTruthy();
    expect(run()).toHaveProperty('disabled', true);
    const first = file('one.txt');
    const folder = file('two.txt', 'folder/two.txt');
    const other = file('three.txt');
    const literal = file('<img src=x onerror=alert(1)>');
    choose([first, first, file('one.txt')]);
    choose([folder, file('two.txt', folder.webkitRelativePath)], true);
    drop([other, file('three.txt'), literal]);
    expect(screen.getAllByRole('listitem').map(row => row.textContent)).toEqual([
      'one.txt1 B', 'folder/two.txt1 B', 'three.txt1 B', `${literal.name}1 B`,
    ]);
    expect(document.querySelector('img')).toBeNull();
    expect(view.props.onCreate).not.toHaveBeenCalled();
    expect(view.props.publish).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
    expect(view.props.onCreateSelectionChange).toHaveBeenLastCalledWith(4);
    fireEvent.click(run());
    expect(view.props.onCreate).toHaveBeenCalledWith([first, folder, other, literal]);
    expect(vi.mocked(view.props.onCreate!).mock.lastCall![0][1]).toBe(folder);
    expect(processed).not.toHaveBeenCalled();
    clear();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(view.props.onCreateSelectionChange).toHaveBeenLastCalledWith(0);
    choose([first]);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  } finally { window.removeEventListener('filesProcessed', processed); }
});

it('checks the deduplicated total at the limit, retains oversize input, and recovers by clearing', () => {
  setup();
  const large = file('large', '', MAX_INPUT_BYTES);
  choose([large, file('large', '', MAX_INPUT_BYTES)]);
  expect(run()).toHaveProperty('disabled', false);
  expect(screen.queryByRole('alert')).toBeNull();
  choose([file('extra')]);
  expect(screen.getByRole('alert').textContent).toBe(t.tooLarge);
  expect(run()).toHaveProperty('disabled', true);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  clear();
  choose([file('small')]);
  expect(run()).toHaveProperty('disabled', false);
});

it('keeps distinct empty paths and metadata while deduplicating within a batch', () => {
  const view = setup();
  const files = [file('a'), file('b'), file('a', '', 2), file('a', '', 1, 2)];
  choose([...files, file('a')]);
  fireEvent.click(run());
  expect(view.props.onCreate).toHaveBeenCalledWith(files);
});

it('shows progress, localized failure and retry, then saves only the explicit result Blob and name', () => {
  const view = setup();
  const selected = file('source');
  choose([selected]);
  const progress = { index: 1, total: 3, name: '<entry>' };
  view.update({ session: { ...view.props.session, create: { input: [selected], run: {
    status: 'running', id: 'run', generation: 0, progress,
  } } } });
  expect(screen.getByRole('status').textContent).toBe(`${t.processingFile}: 2 / 3 <entry>`);
  expect(run()).toHaveProperty('disabled', true);
  view.update({ session: { ...view.props.session, create: { input: [selected], run: {
    status: 'failed', failure: { kind: 'other', message: 'internal detail' },
  } } } });
  expect(screen.getByRole('alert').textContent).toBe(`${t.failure} ${t.retryGuide}`);
  expect(screen.queryByText('internal detail')).toBeNull();
  fireEvent.click(run());
  expect(view.props.onCreate).toHaveBeenCalledWith([selected]);
  const result = { sourceFiles: [selected], blob: new Blob(['zip']), name: 'created.zip' as const, count: 7 };
  view.update({ session: { ...view.props.session, create: { input: [selected], run: { status: 'succeeded' }, result } } });
  expect(screen.getByText(`${t.resultSummary}: 7`)).toBeTruthy();
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: `${t.save}: created.zip` }));
  expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.save).toHaveBeenCalledWith(result.blob, result.name);
  clear();
  expect(screen.getByText(`${t.resultSummary}: 7`)).toBeTruthy();
  expect(view.props.session.create.input).toEqual([selected]);
});

it.each(['busy', 'updating', 'running', 'inactive', 'applying'] as const)('rejects all actions while %s', mode => {
  const view = setup();
  window.__toolReady = true;
  const selected = file('selected');
  choose([selected]);
  view.update({ session: { ...view.props.session, create: { input: [], run: { status: 'idle' }, result: {
    sourceFiles: [], blob: new Blob(), name: 'created.zip', count: 0,
  } } } });
  if (mode === 'busy') view.update({ busy: true });
  if (mode === 'updating') view.update({ updating: true });
  if (mode === 'inactive') view.update({ active: false });
  if (mode === 'running') view.update({ session: { ...view.props.session, create: { ...view.props.session.create,
    run: { status: 'running', id: 'run', generation: 0, progress: { index: 0, total: 1, name: 'selected' } },
  } } });
  if (mode === 'applying') mock.applying = true;
  else for (const control of [...screen.getAllByRole('button'), screen.getByLabelText(t.addFiles), screen.getByLabelText(t.addFolder)]) {
    expect(control).toHaveProperty('disabled', true);
  }
  choose([file('ignored')]);
  choose([file('folder', 'dir/folder')], true);
  drop([file('dropped')]);
  clear();
  fireEvent.click(run());
  fireEvent.click(screen.getByRole('button', { name: `${t.save}: created.zip` }));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(view.props.onCreate).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
});

it('defaults inactive, requires a callback, and accepts drops only while the page is ready', () => {
  const view = setup({ active: undefined });
  window.__toolReady = true;
  choose([file('ignored')]);
  drop([file('ignored')]);
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  view.update({ active: true, onCreate: undefined });
  window.__toolReady = false;
  drop([file('hidden')]);
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  choose([file('selected')]);
  expect(run()).toHaveProperty('disabled', true);
});

it('preserves selection across operation and language changes, clears on generation change, and releases subscriptions', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const view = setup();
  window.__toolReady = true;
  choose([file('retained')]);
  view.update({ active: false, session: { ...view.props.session, op: 'extract' }, locale: 'ja', t: ui.ja.workbench });
  expect(remove.mock.calls.some(([name]) => name === 'filesDropped')).toBe(true);
  drop([file('ignored')]);
  expect(screen.getByText(`${createUi.ja.selectedCount}: 1`)).toBeTruthy();
  expect(screen.getByLabelText(createUi.ja.addFolder)).toBeTruthy();
  view.update({ active: true });
  drop([file('second')]);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  view.update({ session: { ...view.props.session, generation: 1 } });
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(view.props.onCreateSelectionChange).toHaveBeenLastCalledWith(0);
  drop([file('last')]);
  const notified = vi.mocked(view.props.onCreateSelectionChange!);
  expect(notified).toHaveBeenLastCalledWith(1);
  view.unmount();
  expect(notified).toHaveBeenLastCalledWith(0);
  const calls = notified.mock.calls.length;
  drop([file('after')]);
  expect(notified).toHaveBeenCalledTimes(calls);
  remove.mockRestore();
});
