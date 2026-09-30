import type { WorkerApi } from '../engine/worker-api';

type ArchiveOp = keyof Pick<typeof import('../engine/archive/libarchive'), 'openArchive'>;
export type EngineOp = keyof WorkerApi | ArchiveOp;

interface OpDefinition {
  id: string;
  slug: string;
  engineOp: EngineOp;
  i18nKey: string;
  available: boolean;
  archive?: boolean;
}

export const ZIP_SLUGS = {
  browse: 'view',
  extract: 'extract',
  remove: 'remove',
  'fix-names': 'fix-names',
  recover: 'recover',
  split: 'split',
  merge: 'merge',
  unlock: 'unlock',
  encrypt: 'encrypt',
  create: 'create',
  'rar-7z': 'rar-7z',
} as const;

/** A representative engine entry point; execution still follows each operation's own controller path. */
export const OPS = [
  { id: 'browse', slug: ZIP_SLUGS.browse, engineOp: 'listEntries', i18nKey: 'browse', available: true, archive: true },
  { id: 'extract', slug: ZIP_SLUGS.extract, engineOp: 'extractAll', i18nKey: 'extract', available: true, archive: true },
  { id: 'remove', slug: ZIP_SLUGS.remove, engineOp: 'rewriteZip', i18nKey: 'remove', available: true, archive: false },
  { id: 'fix-names', slug: ZIP_SLUGS['fix-names'], engineOp: 'rewriteZip', i18nKey: 'fix-names', available: true, archive: false },
  { id: 'recover', slug: ZIP_SLUGS.recover, engineOp: 'recoverZip', i18nKey: 'recover', available: false },
  { id: 'split', slug: ZIP_SLUGS.split, engineOp: 'splitZip', i18nKey: 'split', available: false },
  { id: 'merge', slug: ZIP_SLUGS.merge, engineOp: 'mergeZips', i18nKey: 'merge', available: false },
  { id: 'unlock', slug: ZIP_SLUGS.unlock, engineOp: 'rewriteZip', i18nKey: 'unlock', available: false },
  { id: 'encrypt', slug: ZIP_SLUGS.encrypt, engineOp: 'rewriteZip', i18nKey: 'encrypt', available: false },
  { id: 'create', slug: ZIP_SLUGS.create, engineOp: 'createZip', i18nKey: 'create', available: false },
  { id: 'rar-7z', slug: ZIP_SLUGS['rar-7z'], engineOp: 'openArchive', i18nKey: 'rar-7z', available: false },
] as const satisfies readonly OpDefinition[];

export type RegistryOpId = typeof OPS[number]['id'];
export type AvailableOp = Extract<typeof OPS[number], { available: true }>;
export type AvailableOpId = AvailableOp['id'];
export const AVAILABLE_OPS: readonly AvailableOp[] = OPS.filter((op): op is AvailableOp => op.available);
export function archiveAvailable(op: AvailableOpId): boolean {
  return AVAILABLE_OPS.find(entry => entry.id === op)?.archive ?? false;
}
