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

/** A representative engine entry point; execution still follows each operation's own controller path. */
export const OPS = [
  { id: 'browse', slug: 'zip-viewer', engineOp: 'listEntries', i18nKey: 'browse', available: true, archive: true },
  { id: 'extract', slug: 'unzip', engineOp: 'extractAll', i18nKey: 'extract', available: true, archive: true },
  { id: 'remove', slug: 'remove-from-zip', engineOp: 'rewriteZip', i18nKey: 'remove', available: true, archive: false },
  { id: 'fix-names', slug: 'zip-filename-fix', engineOp: 'rewriteZip', i18nKey: 'fix-names', available: true, archive: false },
  { id: 'recover', slug: 'recover-zip', engineOp: 'recoverZip', i18nKey: 'recover', available: false },
  { id: 'split', slug: 'split-zip', engineOp: 'splitZip', i18nKey: 'split', available: false },
  { id: 'merge', slug: 'merge-zip', engineOp: 'mergeZips', i18nKey: 'merge', available: false },
  { id: 'unlock', slug: 'unlock-zip', engineOp: 'rewriteZip', i18nKey: 'unlock', available: false },
  { id: 'encrypt', slug: 'encrypt-zip', engineOp: 'rewriteZip', i18nKey: 'encrypt', available: false },
  { id: 'create', slug: 'create-zip', engineOp: 'createZip', i18nKey: 'create', available: false },
  { id: 'rar-7z', slug: 'extract-rar-7z', engineOp: 'openArchive', i18nKey: 'rar-7z', available: false },
] as const satisfies readonly OpDefinition[];

export type RegistryOpId = typeof OPS[number]['id'];
export type AvailableOp = Extract<typeof OPS[number], { available: true }>;
export type AvailableOpId = AvailableOp['id'];
export const AVAILABLE_OPS: readonly AvailableOp[] = OPS.filter((op): op is AvailableOp => op.available);
export function archiveAvailable(op: AvailableOpId): boolean {
  return AVAILABLE_OPS.find(entry => entry.id === op)?.archive ?? false;
}
