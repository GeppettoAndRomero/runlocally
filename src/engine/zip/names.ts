import type { ZipEntry } from '../types';

/** Return the final path segment, ignoring trailing directory separators. */
export function baseName(name: string): string {
  const trimmed = name.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Non-UTF-8 non-ASCII names may need a different character encoding. */
export function isGarbled(entry: ZipEntry): boolean {
  return !entry.utf8 && /[\u0080-\uffff]/.test(entry.name);
}

const shiftJis = new TextDecoder('shift-jis');

/** Decode a legacy filename only when its original bytes are available. */
export function decodeShiftJisName(
  entry: Pick<ZipEntry, 'name' | 'utf8'> & { rawFilename?: Uint8Array },
): string {
  if (entry.utf8 || !entry.rawFilename) return entry.name;
  return shiftJis.decode(entry.rawFilename) || entry.name;
}
