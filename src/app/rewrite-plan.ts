import type { ZipEntry } from '../engine/types';
import { decodeShiftJisName, isGarbled } from '../engine/zip/names';

export function repairedName(entry: ZipEntry): string {
  return isGarbled(entry) ? decodeShiftJisName(entry) : entry.name;
}

export function repairPlan(entries: readonly ZipEntry[]) {
  const changes = entries.map(entry => ({ before: entry.name, after: repairedName(entry) }))
    .filter(item => item.before !== item.after);
  const seen = new Map<string, string>();
  let collision: string | undefined;
  for (const entry of entries) {
    const name = repairedName(entry);
    if (seen.has(name) && seen.get(name) !== entry.name) collision ??= name;
    seen.set(name, entry.name);
  }
  return { changes, collision };
}

export function derivedZipName(name: string, suffix: 'trimmed' | 'fixed'): string {
  return `${name.replace(/\.zip$/i, '')}-${suffix}.zip`;
}
