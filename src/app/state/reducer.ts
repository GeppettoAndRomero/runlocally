import { EngineError } from '../../engine/errors';
import type { ArchiveKind } from '../../engine/sniff';
import type { ZipEntry } from '../../engine/types';
import type { Job, OpInputs, ResultRecord, Session, SessionAction, SessionFailure } from './session';
import { archiveAvailable } from '../../i18n/ops';

export const MAX_INPUT_BYTES = 1_000_000_000;

export function inputSizeFailure(size: number): SessionFailure | undefined {
  return size > MAX_INPUT_BYTES
    ? { kind: 'engine', code: 'too-large', message: 'Input exceeds 1 GB' }
    : undefined;
}

export function failureOf(error: unknown): SessionFailure {
  if (error && typeof error === 'object' && 'kind' in error &&
      (error.kind === 'engine' || error.kind === 'abort' || error.kind === 'other')) return error as SessionFailure;
  if (error instanceof EngineError) return { kind: 'engine', code: error.code, message: error.message };
  if (error instanceof Error && error.name === 'AbortError') return { kind: 'abort', message: error.message };
  return { kind: 'other', message: error instanceof Error ? error.message : String(error) };
}

export interface EntryLike { name: string; directory: boolean }
/** A directory name includes its trailing slash; the boundary prevents a/ matching ab/. */
export function descendants(entries: readonly EntryLike[], dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return entries.filter((entry) => entry.name === dir || entry.name.startsWith(prefix)).map((entry) => entry.name);
}
export function allNames(entries: readonly EntryLike[]): Set<string> {
  return new Set(entries.map((entry) => entry.name));
}
export function applyToggle(entries: readonly EntryLike[], kept: ReadonlySet<string>, target: string, keep: boolean): Set<string> {
  const next = new Set(kept);
  const matches = entries.filter((entry) => entry.name === target);
  if (!matches.length) return next;
  const affected = matches.some((entry) => entry.directory) ? descendants(entries, target) : [target];
  for (const name of affected) {
    if (keep) next.add(name);
    else next.delete(name);
  }
  return next;
}
export function setAll(entries: readonly EntryLike[], keep: boolean): Set<string> {
  return keep ? allNames(entries) : new Set();
}
export function keptFileCount(entries: readonly EntryLike[], kept: ReadonlySet<string>): number {
  return entries.filter((entry) => !entry.directory && kept.has(entry.name)).length;
}
export function removedFileCount(entries: readonly EntryLike[], kept: ReadonlySet<string>): number {
  return entries.filter((entry) => !entry.directory && !kept.has(entry.name)).length;
}
export function isEmptyResult(entries: readonly EntryLike[], kept: ReadonlySet<string>): boolean {
  return keptFileCount(entries, kept) === 0;
}
export function directoryState(entries: readonly EntryLike[], dir: string, kept: ReadonlySet<string>): 'checked' | 'unchecked' | 'indeterminate' {
  if (!entries.some((entry) => entry.name === dir && entry.directory)) return 'unchecked';
  const names = descendants(entries, dir);
  const count = names.filter((name) => kept.has(name)).length;
  return count === 0 ? 'unchecked' : count === names.length ? 'checked' : 'indeterminate';
}

function defaultInputs(): OpInputs {
  return { browse: {}, extract: { mode: 'all' }, remove: {}, 'fix-names': {} };
}

export function initialSession(generation = 0, op: Session['op'] = 'browse'): Session {
  return { generation, source: null, listing: { status: 'idle' }, entries: [], archiveEntries: [],
    selection: new Set(), op, inputs: defaultInputs(), job: { status: 'idle' },
    results: [], log: [] };
}

function withSource(state: Session, file: File, kind: ArchiveKind, chain: readonly string[]): Session {
  const failure = inputSizeFailure(file.size);
  if (failure) return { ...state, inputFailure: failure };
  return { ...state, generation: state.generation + 1, source: { file, kind, chain },
    listing: { status: 'idle' }, entries: [], archiveEntries: [], selection: new Set(), job: { status: 'idle' },
    inputs: { ...state.inputs, extract: { mode: 'all' } },
    op: kind === 'zip' || archiveAvailable(state.op) ? state.op : 'browse',
    inputFailure: undefined };
}

function isActiveJob(state: Session, generation: number, id: string): state is Session & { job: Extract<Job, { status: 'running' }> } {
  return state.generation === generation && state.job.status === 'running' &&
    state.job.generation === generation && state.job.id === id;
}

function settledInputFailure(state: Session): SessionFailure | undefined {
  return state.inputFailure?.message === 'busy' ? undefined : state.inputFailure;
}

function resultFor(action: Extract<SessionAction, { type: 'job/success' }>, sourceFile: File, sourceChain: readonly string[]): ResultRecord | undefined {
  if (action.op === 'browse') return undefined;
  if (action.op === 'extract') {
    return { id: action.resultId, op: action.op, sourceFile, sourceChain: [...sourceChain],
      files: action.output.map(({ name, blob }) => ({ name, blob })),
      actual: { kind: 'extract', files: action.output.length } };
  }
  const { name, rewrite } = action.output;
  const { blob, ...counts } = rewrite;
  return { id: action.resultId, op: action.op, sourceFile, sourceChain: [...sourceChain],
    files: [{ name, blob }], actual: { kind: 'rewrite', counts } };
}

/** Pure transition: request IDs and input generations reject late notifications. */
export function sessionReducer(state: Session, action: SessionAction): Session {
  switch (action.type) {
    case 'input/accept': return withSource(state, action.file, action.kind, []);
    case 'input/reject': return { ...state, inputFailure: failureOf(action.error) };
    case 'result/reinput': {
      const result = state.results.find((item) => item.id === action.resultId);
      if (!result) return state;
      return withSource(state, action.file, action.kind, [...result.sourceChain, result.id]);
    }
    case 'reset': return initialSession(state.generation + 1);
    case 'listing/start':
      if (!state.source || state.source.kind === 'unknown' || action.generation !== state.generation || state.job.status === 'running') return state;
      return { ...state, listing: { status: 'reading', route: state.source.kind === 'zip' ? 'zip' : 'archive', requestId: action.requestId },
        entries: state.entries, archiveEntries: state.archiveEntries, selection: state.selection };
    case 'listing/success':
      if (action.generation !== state.generation || state.listing.status !== 'reading' ||
          state.listing.requestId !== action.requestId || state.listing.route !== action.route) return state;
      if (action.route === 'archive') return { ...state, inputFailure: settledInputFailure(state), listing: { status: 'ready', route: 'archive', requestId: action.requestId },
        archiveEntries: action.entries.map(entry => ({ ...entry })), entries: [], selection: new Set() };
      return { ...state, inputFailure: settledInputFailure(state), listing: { status: 'ready', route: 'zip', requestId: action.requestId },
        entries: action.entries.map((entry): ZipEntry => ({ ...entry, rawFilename: entry.rawFilename?.slice() })), archiveEntries: [], selection: allNames(action.entries) };
    case 'listing/failure':
      if (action.generation !== state.generation || state.listing.status !== 'reading' ||
          state.listing.requestId !== action.requestId) return state;
      return { ...state, inputFailure: settledInputFailure(state), listing: { status: 'error', route: state.listing.route, requestId: action.requestId, failure: failureOf(action.error) } };
    case 'selection/toggle':
      return state.listing.status === 'ready' && state.listing.route === 'zip' ? { ...state, selection: applyToggle(state.entries, state.selection, action.name, action.keep) } : state;
    case 'selection/all':
      return state.listing.status === 'ready' && state.listing.route === 'zip' ? { ...state, selection: setAll(state.entries, action.keep) } : state;
    case 'op/select': return !state.source || state.source.kind === 'zip' || archiveAvailable(action.op)
      ? { ...state, op: action.op } : state;
    case 'op/input': return { ...state, inputs: { ...state.inputs, [action.op]: action.input } };
    case 'job/start': {
      if (!state.source || state.source.kind === 'unknown' || state.listing.status !== 'ready' ||
          (action.op === 'browse' || (state.listing.route === 'archive' && action.op !== 'extract')) ||
          action.generation !== state.generation || state.job.status === 'running') return state;
      // The input and kept names are snapshots; later controls do not change this job.
      const job = { status: 'running', id: action.id, generation: action.generation,
        op: action.op, input: { ...state.inputs[action.op] }, kept: new Set(state.selection) } as Job;
      return { ...state, job };
    }
    case 'job/progress':
      if (!isActiveJob(state, action.generation, action.id)) return state;
      if ((state.job.op === 'extract' && action.progress.kind !== 'extract') ||
          ((state.job.op === 'remove' || state.job.op === 'fix-names') && action.progress.kind !== 'rewrite') ||
          state.job.op === 'browse') return state;
      return { ...state, job: { ...state.job, progress: action.progress } };
    case 'job/success': {
      if (!isActiveJob(state, action.generation, action.id) || state.job.op !== action.op || !state.source) return state;
      const result = resultFor(action, state.source.file, state.source.chain);
      if (result && state.results.some((item) => item.id === result.id)) return state;
      const summary = action.op === 'browse' ? `${action.output.length} entries` :
        result?.actual.kind === 'extract' ? `${result.actual.files} files` :
        `${result?.actual.kind === 'rewrite' ? result.actual.counts.kept : 0} entries kept`;
      return { ...state, inputFailure: settledInputFailure(state), job: { status: 'succeeded', id: action.id, generation: action.generation, op: action.op },
        results: result ? [...state.results, result] : state.results,
        log: [...state.log, { jobId: action.id, op: action.op, at: action.at, summary }] };
    }
    case 'job/failure':
      if (!isActiveJob(state, action.generation, action.id)) return state;
      return { ...state, inputFailure: settledInputFailure(state), job: { status: 'failed', id: action.id, generation: action.generation,
        op: state.job.op, failure: failureOf(action.error) } };
  }
}
