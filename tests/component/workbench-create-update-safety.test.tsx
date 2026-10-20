import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench, isWorkbenchUpdateSafe } from '../../src/app/Workbench';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import type { CreateState, Session } from '../../src/app/state/session';
import { WorkbenchController } from '../../src/app/workbench-controller';
import { PwaStartup } from '../../src/ui/PwaStartup';
import type { UpdateState } from '../../src/app/registerSW';
import { updateUi } from '../../src/i18n/ui';

const mock = vi.hoisted(() => ({ seed: undefined as Session | undefined, create: vi.fn(), startup: vi.fn(), apply: vi.fn() }));
vi.mock('../../src/app/state/reducer', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/app/state/reducer')>();
  return { ...actual, initialSession: (...args: Parameters<typeof actual.initialSession>) => mock.seed ?? actual.initialSession(...args) };
});
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ createZip: mock.create, terminate: vi.fn() }) }));
vi.mock('../../src/ui/PwaStartup', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/ui/PwaStartup')>();
  return { PwaStartup: (props: Parameters<typeof actual.PwaStartup>[0]) => {
    mock.startup(props);
    return <actual.PwaStartup {...props} />;
  } };
});
vi.mock('../../src/app/registerSW', () => ({
  isUpdateApplying: () => false,
  registerSW: vi.fn(),
  retrySW: vi.fn(),
  applyUpdate: mock.apply,
  subscribeUpdate: (listener: (state: UpdateState) => void) => {
    listener({ waiting: {} as ServiceWorker, error: null, otherTabs: false, canCoordinate: true,
      applying: false, reloadDeferred: false });
    return () => {};
  },
}));
const file = new File(['text'], 'item.txt');
const result: NonNullable<CreateState['result']> = { sourceFiles: [file], blob: new Blob(['zip']), name: 'created.zip', count: 1 };
const failure = { kind: 'other', message: 'Cannot create' } as const;
const cases: { name: string; create: CreateState }[] = [
  { name: 'input only', create: { input: [file], run: { status: 'idle' } } },
  { name: 'running without input', create: { input: [], run: { status: 'running', id: 'create', generation: 0,
    progress: { index: 0, total: 1, name: file.name } } } },
  { name: 'result only', create: { input: [], run: { status: 'idle' }, result } },
  { name: 'failed with input', create: { input: [file], run: { status: 'failed', failure } } },
  { name: 'failed with result', create: { input: [], run: { status: 'failed', failure }, result } },
];
afterEach(() => {
  cleanup();
  mock.seed = undefined;
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/en/zip/');
});
function startup(): Parameters<typeof PwaStartup>[0] { return mock.startup.mock.lastCall![0]; }

it.each(cases)('defers updates and resets retained creation: $name', async ({ create }) => {
  mock.seed = { ...initialSession(), create };
  const idleController = new WorkbenchController(() => {});
  expect(isWorkbenchUpdateSafe(mock.seed, null)).toBe(false);
  expect(isWorkbenchUpdateSafe(mock.seed, idleController)).toBe(false);
  render(<Workbench locale="en" />);
  const update = await screen.findByRole('button', { name: 'Update' });
  expect(startup().hasWork).toBe(true);
  expect(startup().isSafe?.()).toBe(false);
  expect(update).toHaveProperty('disabled', true);
  expect(screen.getByText(updateUi.en.work)).toBeTruthy();
  update.click();
  expect(mock.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(update).toHaveProperty('disabled', false));
  expect(startup().hasWork).toBe(false);
  expect(startup().isSafe?.()).toBe(true);
  expect(screen.queryByRole('button', { name: /^Reset:/ })).toBeNull();
  expect(screen.queryByText(updateUi.en.work)).toBeNull();
  update.click();
  expect(mock.apply).toHaveBeenCalledOnce();
  expect(mock.apply.mock.lastCall![0]()).toBe(true);
  idleController.dispose();
});

it('allows resetting a failure with no retained input or result', async () => {
  mock.seed = { ...initialSession(), create: { input: [], run: { status: 'failed', failure } } };
  render(<Workbench locale="en" />);
  expect(startup().hasWork).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Reset:/ })).toBeNull());
  expect(startup().isSafe?.()).toBe(true);
});

it('protects controller-created input and results until the controller resets', async () => {
  let state = initialSession(0, 'create');
  const controller = new WorkbenchController(action => { state = sessionReducer(state, action); });
  let resolve!: (blob: Blob) => void;
  mock.create.mockReturnValue(new Promise<Blob>(done => { resolve = done; }));
  const running = controller.createFrom([file], state);
  expect(state.create.run.status).toBe('running');
  expect(isWorkbenchUpdateSafe(state, controller)).toBe(false);
  controller.dispatch({ type: 'op/select', op: 'extract' });
  resolve(result.blob);
  await running;
  expect(state.create.result?.blob).toBe(result.blob);
  expect(isWorkbenchUpdateSafe(state, controller)).toBe(false);
  controller.reset();
  expect(isWorkbenchUpdateSafe(state, controller)).toBe(true);
  controller.dispose();
});

it('uses the public route for menu selection while create remains unpublished', () => {
  mock.seed = { ...initialSession(0, 'create'), source: { file, kind: 'zip', chain: [] } };
  render(<Workbench locale="en" page="extract" op="extract" />);
  expect(screen.getByRole('tab', { selected: true }).id).toBe('tab-extract');
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(document.getElementById('tab-create')).toBeNull();
  expect(document.getElementById('panel-create')).toBeNull();
});

it('shows the panel of the selected tab while the state operation is unpublished', () => {
  mock.seed = { ...initialSession(0, 'create'), source: { file, kind: 'zip', chain: [] } };
  render(<Workbench locale="en" page="extract" op="extract" />);
  const selected = screen.getByRole('tab', { selected: true });
  expect(selected.id).toBe('tab-extract');
  const panel = document.getElementById(selected.getAttribute('aria-controls')!)!;
  expect(panel.hidden).toBe(false);
  expect([...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter(item => !item.hidden)).toEqual([panel]);
});
