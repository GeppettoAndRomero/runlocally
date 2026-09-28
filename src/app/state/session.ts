import type { ZipEntry, ExtractedFile } from '../../engine/types';
import type { EngineErrorCode } from '../../engine/errors';
import type { RewriteProgress, RewriteResult } from '../../engine/zip/rewrite';
import type { ArchiveKind } from '../../engine/sniff';
import type { ArchiveEntryInfo } from '../../engine/archive/libarchive';

/** Add an operation by extending these keyed maps, then its result handling in the reducer. */
export interface OpInputMap {
  browse: Record<string, never>;
  extract: { mode: 'one'; name: string } | { mode: 'all' };
  remove: Record<string, never>;
  'fix-names': Record<string, never>;
}

export interface OpOutputMap {
  browse: ZipEntry[];
  extract: ExtractedFile[];
  remove: { name: string; rewrite: RewriteResult };
  'fix-names': { name: string; rewrite: RewriteResult };
}

export type OpId = keyof OpInputMap & keyof OpOutputMap;
export type OpInputs = { [K in OpId]: OpInputMap[K] };

export type SessionFailure =
  | { kind: 'engine'; code: EngineErrorCode; message: string }
  | { kind: 'abort'; message: string }
  | { kind: 'other'; message: string };

/** A chain is explicit: finishing a job never replaces the source automatically. */
export interface Source {
  file: File;
  kind: ArchiveKind;
  chain: readonly string[];
}

export type ListingRoute = 'zip' | 'archive';
export type Listing =
  | { status: 'idle' }
  | { status: 'reading'; route: ListingRoute; requestId: string }
  | { status: 'ready'; route: ListingRoute; requestId: string }
  | { status: 'error'; route: ListingRoute; requestId: string; failure: SessionFailure };

export type JobProgress =
  | { kind: 'extract'; done: number; total: number }
  | { kind: 'rewrite'; progress: RewriteProgress };

export type Job =
  | { status: 'idle' }
  | { [K in OpId]: {
      status: 'running'; id: string; generation: number; op: K;
      input: OpInputMap[K]; kept: ReadonlySet<string>; progress?: JobProgress;
    } }[OpId]
  | { status: 'succeeded'; id: string; generation: number; op: OpId }
  | { status: 'failed'; id: string; generation: number; op: OpId; failure: SessionFailure };

export interface ResultFile { name: string; blob: Blob }
export interface ResultRecord {
  id: string;
  op: Exclude<OpId, 'browse'>;
  sourceFile: File;
  /** Chain of the source when this result was created. */
  sourceChain: readonly string[];
  files: readonly ResultFile[];
  /** Extract counts returned files; rewrite counts are actual API counts including directories. */
  actual: { kind: 'extract'; files: number } | { kind: 'rewrite'; counts: Omit<RewriteResult, 'blob'> };
}

export interface LogRecord { jobId: string; op: OpId; at: number; summary: string }

export interface Session {
  generation: number;
  source: Source | null;
  listing: Listing;
  entries: readonly ZipEntry[];
  archiveEntries: readonly ArchiveEntryInfo[];
  /** Names kept by rewrite. Duplicate names share one choice: extractOne uses the first match. */
  selection: ReadonlySet<string>;
  op: OpId;
  inputs: OpInputs;
  job: Job;
  results: readonly ResultRecord[];
  log: readonly LogRecord[];
  inputFailure?: SessionFailure;
}

export type JobStart = { [K in OpId]: {
  type: 'job/start'; generation: number; id: string; op: K;
} }[OpId];
export type JobSuccess = { [K in OpId]: {
  type: 'job/success'; generation: number; id: string; op: K;
  output: OpOutputMap[K]; resultId: string; at: number;
} }[OpId];

/** IDs, timestamps, read results, and derived Files enter through actions. */
export type SessionAction =
  | { type: 'input/accept'; file: File; kind: ArchiveKind }
  | { type: 'input/reject'; error: unknown }
  | { type: 'result/reinput'; resultId: string; file: File; kind: ArchiveKind }
  | { type: 'listing/start'; generation: number; requestId: string }
  | { type: 'listing/success'; generation: number; requestId: string; route: 'zip'; entries: readonly ZipEntry[] }
  | { type: 'listing/success'; generation: number; requestId: string; route: 'archive'; entries: readonly ArchiveEntryInfo[] }
  | { type: 'listing/failure'; generation: number; requestId: string; error: unknown }
  | { type: 'selection/toggle'; name: string; keep: boolean }
  | { type: 'selection/all'; keep: boolean }
  | { type: 'op/select'; op: OpId }
  | { [K in OpId]: { type: 'op/input'; op: K; input: OpInputMap[K] } }[OpId]
  | JobStart
  | { type: 'job/progress'; generation: number; id: string; progress: JobProgress }
  | JobSuccess
  | { type: 'job/failure'; generation: number; id: string; error: unknown }
  | { type: 'reset' };
