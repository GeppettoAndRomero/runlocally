import { describe, expect, it } from 'vitest';
import { initialSession, sessionReducer } from '../../src/app/state/reducer';
import type { Session, SessionAction } from '../../src/app/state/session';

const item = (name = 'item.txt') => new File(['x'], name);
const zip = () => new File(['zip'], 'other.zip');
const apply = (state: Session, ...actions: SessionAction[]) => actions.reduce(sessionReducer, state);

// A session that has created a ZIP: the executed input and the unsaved created.zip are in `create`.
function created(): Session {
  const files = [item('a.txt'), item('b.txt')];
  return apply(initialSession(0, 'create'),
    { type: 'create/start', generation: 0, id: 'first', files },
    { type: 'create/success', generation: 0, id: 'first', blob: new Blob(['created']) });
}

describe('a new archive input after a created ZIP', () => {
  it('keeps the created.zip and the input that made it, like the other results', () => {
    const before = created();
    const after = sessionReducer(before, { type: 'input/accept', file: zip(), kind: 'zip' });
    expect(after.generation).toBe(before.generation + 1);
    expect(after.create.result).toBe(before.create.result);
    expect(after.create.input).toBe(before.create.result!.sourceFiles);
    expect(after.create.run.status).toBe('succeeded');
    expect(after.source?.file.name).toBe('other.zip');
  });

  it('keeps it when the new input is the reinput of another result', () => {
    const before = created();
    const withSource = sessionReducer(before, { type: 'input/accept', file: zip(), kind: 'zip' });
    const reinput = sessionReducer({ ...withSource, results: [{ id: 'r1', sourceChain: [] } as never] },
      { type: 'result/reinput', resultId: 'r1', file: zip(), kind: 'zip' });
    expect(before.create.result).toBeDefined();
    expect(reinput.create.result).toBe(before.create.result);
  });

  it('cuts off a creation that is still running but keeps the earlier result, and rejects its late notifications', () => {
    const before = created();
    const running = sessionReducer(before, { type: 'create/start', generation: before.generation, id: 'second', files: [item('c.txt')] });
    expect(running.create.run.status).toBe('running');
    const after = sessionReducer(running, { type: 'input/accept', file: zip(), kind: 'zip' });
    expect(after.create.run).toEqual({ status: 'idle' });
    expect(after.create.result).toBe(before.create.result);
    expect(after.create.input).toBe(before.create.result!.sourceFiles);
    const late: SessionAction[] = [
      { type: 'create/progress', generation: running.generation, id: 'second', progress: { index: 0, total: 1, name: 'c.txt' } },
      { type: 'create/success', generation: running.generation, id: 'second', blob: new Blob(['late']) },
      { type: 'create/failure', generation: running.generation, id: 'second', error: Error('late') },
    ];
    for (const action of late) expect(sessionReducer(after, action)).toBe(after);
  });

  it('drops a failed run but keeps the result it follows', () => {
    const before = created();
    const failed = apply(before,
      { type: 'create/start', generation: before.generation, id: 'second', files: [item('c.txt')] },
      { type: 'create/failure', generation: before.generation, id: 'second', error: Error('failed') });
    expect(failed.create.run.status).toBe('failed');
    const after = sessionReducer(failed, { type: 'input/accept', file: zip(), kind: 'zip' });
    expect(after.create.run).toEqual({ status: 'idle' });
    expect(after.create.result).toBe(before.create.result);
  });

  it('starts over when there is no result to keep', () => {
    const running = sessionReducer(initialSession(0, 'create'), { type: 'create/start', generation: 0, id: 'only', files: [item()] });
    const after = sessionReducer(running, { type: 'input/accept', file: zip(), kind: 'zip' });
    expect(after.create).toEqual(initialSession().create);
  });

  it('is still cleared by Reset', () => {
    const after = sessionReducer(sessionReducer(created(), { type: 'input/accept', file: zip(), kind: 'zip' }), { type: 'reset' });
    expect(after.create).toEqual(initialSession().create);
  });
});
