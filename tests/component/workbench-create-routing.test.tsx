import type { ComponentType } from 'preact';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench, isWorkbenchUpdateSafe } from '../../src/app/Workbench';
import { initialSession } from '../../src/app/state/reducer';
import type { Session } from '../../src/app/state/session';
import type { PanelProps } from '../../src/app/panels';
import { WorkbenchController } from '../../src/app/workbench-controller';
import type { PwaStartup } from '../../src/ui/PwaStartup';
import { createUi } from '../../src/i18n/ui';

const mock = vi.hoisted(() => ({
  seed: undefined as Session | undefined,
  props: new Map<string, PanelProps>(),
  applying: false,
  mountCreate: true,
  startup: vi.fn(),
}));
vi.mock('../../src/app/state/reducer', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/app/state/reducer')>();
  return { ...actual, initialSession: (...args: Parameters<typeof actual.initialSession>) => mock.seed ?? actual.initialSession(...args) };
});
vi.mock('../../src/app/panels', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/app/panels')>();
  const adapter = (id: string, Panel: ComponentType<PanelProps>) => (props: PanelProps) => {
    mock.props.set(id, props);
    return id === 'create' && !mock.mountCreate ? null : <Panel {...props} />;
  };
  return { ...actual, panelRegistry: {
    ...actual.panelRegistry,
    create: adapter('create', actual.panelRegistry.create),
    browse: adapter('browse', actual.panelRegistry.browse),
    extract: adapter('extract', actual.panelRegistry.extract),
    remove: adapter('remove', actual.panelRegistry.remove),
    'fix-names': adapter('fix-names', actual.panelRegistry['fix-names']),
  } };
});
vi.mock('../../src/ui/PwaStartup', () => ({
  PwaStartup: (props: Parameters<typeof PwaStartup>[0]) => { mock.startup(props); return null; },
}));
vi.mock('../../src/app/registerSW', () => ({
  isUpdateApplying: () => mock.applying,
  subscribeUpdate: () => () => {},
}));
const file = new File(['text'], 'item.txt');
function seedCreate() {
  mock.seed = { ...initialSession(3, 'create'), source: { file: new File(['zip'], 'source.zip'), kind: 'zip', chain: [] } };
}
function props(): PanelProps { return mock.props.get('create')!; }
function startup(): Parameters<typeof PwaStartup>[0] { return mock.startup.mock.lastCall![0]; }
function drop(files = [file]) { fireEvent(window, new CustomEvent('filesDropped', { detail: files })); }
function processed() {
  const listener = vi.fn();
  window.addEventListener('filesProcessed', listener);
  return { listener, remove: () => window.removeEventListener('filesProcessed', listener) };
}
afterEach(() => {
  cleanup();
  mock.seed = undefined;
  mock.props.clear();
  mock.applying = false;
  mock.mountCreate = true;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/en/zip/');
});

it('routes create drops to the real active panel through the published panel', async () => {
  seedCreate();
  const accept = vi.spyOn(WorkbenchController.prototype, 'accept').mockResolvedValue();
  const panel = render(<Workbench locale="en" page="create" op="create" />);
  expect(screen.getAllByRole('tab')).toHaveLength(5);
  expect(screen.getByRole('tab', { selected: true }).id).toBe('tab-create');
  expect(document.getElementById('tab-create')).not.toBeNull();
  expect(document.getElementById('panel-create')).not.toBeNull();
  expect(props().active).toBe(true);
  expect(mock.props.get('browse')?.active).toBe(false);
  expect(screen.queryByLabelText('Choose an archive')).toBeNull();
  expect(screen.getByRole('button', { name: /^Reset:/ })).toBeTruthy();
  const notification = processed();
  try {
    drop();
    expect(accept).not.toHaveBeenCalled();
    expect(notification.listener).toHaveBeenCalledOnce();
    expect(panel.getByText(`${createUi.en.selectedCount}: 1`)).toBeTruthy();
    expect(panel.getByText(file.name)).toBeTruthy();
    expect(startup().isSafe?.()).toBe(false);
    fireEvent.click(document.getElementById('tab-browse')!);
    const other = new File(['other'], 'other.txt');
    drop([other]);
    expect(document.querySelector('#panel-create')?.textContent).not.toContain('other.txt');
    expect(accept).toHaveBeenCalledWith([other], props().session);
    await waitFor(() => expect(notification.listener).toHaveBeenCalledTimes(2));
  } finally { notification.remove(); }
});

it.each(['browse', 'extract', 'remove', 'fix-names'] as const)('keeps the shared picker and archive acceptance for %s', async op => {
  const accept = vi.spyOn(WorkbenchController.prototype, 'accept').mockResolvedValue();
  render(<Workbench locale="en" page={op} op={op} />);
  const picker = screen.getByLabelText('Choose an archive');
  expect(picker.getAttribute('type')).toBe('file');
  expect(picker.hasAttribute('multiple')).toBe(false);
  expect(picker.getAttribute('aria-describedby')).toBe('workbench-drop-hint');
  const notification = processed();
  try {
    drop();
    await waitFor(() => expect(notification.listener).toHaveBeenCalledOnce());
    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith([file], props().session);
    fireEvent.change(picker, { target: { files: [file] } });
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept.mock.lastCall).toEqual([[file], props().session]);
    expect(notification.listener).toHaveBeenCalledOnce();
  } finally { notification.remove(); }
});

it.each([false, true])('ignores drops during synchronous update application (create: %s)', create => {
  if (create) seedCreate();
  const accept = vi.spyOn(WorkbenchController.prototype, 'accept').mockResolvedValue();
  render(<Workbench locale="en" page="extract" op="extract" />);
  mock.applying = true;
  const notification = processed();
  try {
    drop();
    expect(accept).not.toHaveBeenCalled();
    expect(notification.listener).toHaveBeenCalledOnce();
    if (create) expect(screen.getByText(`${createUi.en.selectedCount}: 0`)).toBeTruthy();
  } finally { notification.remove(); }
});

it('uses the latest session from an earlier execution callback after Reset and guards updates at invocation', async () => {
  seedCreate();
  const create = vi.spyOn(WorkbenchController.prototype, 'createFrom').mockResolvedValue();
  render(<Workbench locale="en" page="extract" op="extract" />);
  const oldSession = props().session;
  const onCreate = props().onCreate!;
  onCreate([file]);
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith([file], oldSession);
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(props().session.generation).toBe(oldSession.generation + 1));
  onCreate([file]);
  expect(create.mock.lastCall).toEqual([[file], props().session]);
  expect(create.mock.lastCall?.[1]).not.toBe(oldSession);
  mock.applying = true;
  onCreate([file]);
  expect(create).toHaveBeenCalledTimes(2);
});

it('protects pending selection synchronously, allows Reset, and releases protection on clear and unmount', async () => {
  const panel = render(<Workbench locale="en" page="create" op="create" />);
  const safe = startup().isSafe!;
  expect(safe()).toBe(true);
  expect(screen.queryByRole('button', { name: /^Reset:/ })).toBeNull();
  act(() => {
    props().onCreateSelectionChange!(1);
    expect(safe()).toBe(false);
  });
  expect(startup().hasWork).toBe(true);
  expect(screen.getByRole('button', { name: /^Reset:/ })).toBeTruthy();
  fireEvent.change(panel.getByLabelText(createUi.en.addFiles), { target: { files: [file] } });
  fireEvent.click(panel.getByRole('button', { name: createUi.en.clearSelection }));
  expect(safe()).toBe(true);
  expect(startup().hasWork).toBe(false);
  expect(screen.queryByRole('button', { name: /^Reset:/ })).toBeNull();
  fireEvent.change(panel.getByLabelText(createUi.en.addFiles), { target: { files: [file] } });
  expect(safe()).toBe(false);
  const generation = props().session.generation;
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(props().session.generation).toBe(generation + 1));
  await waitFor(() => expect(startup().hasWork).toBe(false));
  expect(panel.getByText(`${createUi.en.selectedCount}: 0`)).toBeTruthy();
  expect(safe()).toBe(true);
  fireEvent.change(panel.getByLabelText(createUi.en.addFiles), { target: { files: [file] } });
  mock.mountCreate = false;
  panel.rerender(<Workbench locale="en" page="create" op="create" />);
  await waitFor(() => expect(startup().hasWork).toBe(false));
  expect(safe()).toBe(true);
});

it('clears only pending selection while retaining executed input and results until Reset', async () => {
  seedCreate();
  const result: NonNullable<Session['create']['result']> = { sourceFiles: [file], blob: new Blob(['zip']), name: 'created.zip', count: 1 };
  mock.seed = { ...mock.seed!, create: { input: [file], run: { status: 'succeeded' }, result } };
  const panel = render(<Workbench locale="en" page="create" op="create" />);
  fireEvent.change(panel.getByLabelText(createUi.en.addFiles), { target: { files: [file] } });
  fireEvent.click(panel.getByRole('button', { name: createUi.en.clearSelection }));
  expect(props().session.create.input).toEqual([file]);
  expect(props().session.create.result).toBe(result);
  expect(startup().hasWork).toBe(true);
  expect(startup().isSafe?.()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(props().session.create.input).toEqual([]));
  expect(props().session.create.result).toBeUndefined();
});

it('includes optional pending selection in the standalone safety predicate', () => {
  expect(isWorkbenchUpdateSafe(initialSession(), null)).toBe(true);
  expect(isWorkbenchUpdateSafe(initialSession(), null, 1)).toBe(false);
});
