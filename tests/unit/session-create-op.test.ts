import { beforeEach, expect, it, vi } from 'vitest';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import type { OpId, Session, SessionAction, SessionOp } from '../../src/app/state/session';
import { WorkbenchController } from '../../src/app/workbench-controller';
import type { ArchiveKind } from '../../src/engine/sniff';

const mock = vi.hoisted(() => ({ factory: vi.fn(), open: vi.fn(), rewrite: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: mock.factory, openArchive: mock.open }));
const file = new File(['text'], 'item.txt');
const blob = new Blob(['zip']);
const select: SessionAction = { type: 'op/select', op: 'create' };
const publicOps: readonly OpId[] = ['browse', 'extract', 'remove', 'fix-names'];
beforeEach(() => {
  vi.resetAllMocks();
  mock.factory.mockReturnValue({ rewriteZip: mock.rewrite, terminate: vi.fn() });
});

it('accepts create in session initialization, assignment and selection', () => {
  const op: SessionOp = 'create';
  const state: Session = initialSession(0, op);
  state.op = op;
  expect(state.op).toBe('create');
  expect(sessionReducer(initialSession(), select).op).toBe('create');
  expect(Object.keys(state.inputs)).toEqual(publicOps);
});

it.each([null, 'zip', 'tar', 'rar', '7z', 'gzip', 'unknown'] as const)('selects create without changing retained state for %s', kind => {
  let state = initialSession();
  if (kind) state = sessionReducer(state, { type: 'input/accept', file, kind });
  state = sessionReducer(state, { type: 'create/start', generation: state.generation, id: 'first', files: [file] });
  state = sessionReducer(state, { type: 'create/success', generation: state.generation, id: 'first', blob });
  const selected = sessionReducer(state, select);
  expect(selected).toEqual({ ...state, op: 'create' });
  expect(selected.source).toBe(state.source);
  expect(selected.results).toBe(state.results);
  expect(selected.create).toBe(state.create);
});

it.each<ArchiveKind>(['zip', 'tar', 'rar', '7z', 'gzip', 'unknown'])('corrects selection and clears creation on new %s input', kind => {
  const state = sessionReducer(initialSession(0, 'create'), { type: 'create/start', generation: 0, id: 'old', files: [file] });
  const next = sessionReducer(state, { type: 'input/accept', file, kind });
  expect(next.op).toBe(kind === 'zip' ? 'create' : 'browse');
  expect(next.create).toEqual(initialSession().create);
  expect(next.generation).toBe(1);
});

it.each(publicOps)('preserves a running creation and prior result when switching to %s', op => {
  let state = sessionReducer(initialSession(0, 'create'), { type: 'create/start', generation: 0, id: 'first', files: [file] });
  state = sessionReducer(state, { type: 'create/success', generation: 0, id: 'first', blob });
  state = sessionReducer(state, { type: 'create/start', generation: 0, id: 'next', files: [file] });
  const selected = sessionReducer(state, { type: 'op/select', op });
  expect(selected.generation).toBe(state.generation);
  expect(selected.create).toBe(state.create);
  expect(selected.create.run).toMatchObject({ status: 'running', id: 'next', generation: 0 });
  expect(selected.create.result?.blob).toBe(blob);
  const progressed = sessionReducer(selected, { type: 'create/progress', generation: 0, id: 'next',
    progress: { index: 1, total: 1, name: file.name } });
  expect(progressed.create.run).toMatchObject({ progress: { index: 1 } });
  const result = new Blob(['next']);
  const done = sessionReducer(progressed, { type: 'create/success', generation: 0, id: 'next', blob: result });
  expect(done.op).toBe(op);
  expect(done.create.input).toBe(state.create.input);
  expect(done.create.result?.blob).toBe(result);
  expect(done.create.run.status).toBe('succeeded');
});

it.each(['reset', 'input/accept'] as const)('ignores old creation notifications after %s', type => {
  const running = sessionReducer(initialSession(0, 'create'), { type: 'create/start', generation: 0, id: 'old', files: [file] });
  const next = sessionReducer(running, type === 'reset' ? { type } : { type, file, kind: 'zip' });
  expect(next.create).toEqual(initialSession().create);
  const notifications: SessionAction[] = [
    { type: 'create/progress', generation: 0, id: 'old', progress: { index: 1, total: 1, name: file.name } },
    { type: 'create/success', generation: 0, id: 'old', blob },
    { type: 'create/failure', generation: 0, id: 'old', error: Error('late') },
  ];
  for (const action of notifications) expect(sessionReducer(next, action)).toBe(next);
});

it.each(['zip', 'tar'] as const)('does not start an existing job or processing for create with ready %s input', async kind => {
  const publish = vi.fn();
  const processing = vi.fn();
  const controller = new WorkbenchController(publish, processing);
  const state: Session = { ...initialSession(0, 'create'), source: { file, kind, chain: [] },
    listing: { status: 'ready', route: kind === 'zip' ? 'zip' : 'archive', requestId: 'ready' } };
  await controller.run(state);
  expect(publish).not.toHaveBeenCalled();
  expect(processing).not.toHaveBeenCalled();
  expect(controller.processing).toBe(false);
  expect(mock.factory).not.toHaveBeenCalled();
  expect(mock.open).not.toHaveBeenCalled();
  expect(mock.rewrite).not.toHaveBeenCalled();
  controller.dispose();
});
