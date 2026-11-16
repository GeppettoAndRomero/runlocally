import type { ZipEntry } from '../types';
import { decodeCp437 } from './cp437';

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

let shiftJis: TextDecoder | undefined;

/** Decode a legacy filename only when its original bytes are available. */
export function decodeShiftJisName(
  entry: Pick<ZipEntry, 'name' | 'utf8'> & { rawFilename?: Uint8Array },
): string {
  if (entry.utf8 || !entry.rawFilename) return entry.name;
  shiftJis ??= new TextDecoder('shift-jis');
  return shiftJis.decode(entry.rawFilename) || entry.name;
}


export type NameEncoding = 'original' | 'shift_jis' | 'cp437' | 'gbk' | 'gb18030' | 'big5' | 'euc-kr';
export type NameSource = { encoding: NameEncoding; normalization: 'none' | 'NFC' };
export type NameReason = 'control' | 'replacement' | 'private-use' | 'box-drawing' | 'kana' | 'hangul';
export type NameCandidate = { name: string; sources: NameSource[]; score: number; reasons: NameReason[] };
export type NameDiagnostic = {
  encoding: 'shift_jis' | 'gb18030' | 'big5' | 'euc-kr';
  reason: 'unsupported-decoder' | 'invalid-bytes';
};
export type NameCandidateResult = { candidates: NameCandidate[]; diagnostics: NameDiagnostic[] };

function assessName(name: string): Pick<NameCandidate, 'score' | 'reasons'> {
  const counts = { control: 0, replacement: 0, 'private-use': 0, 'box-drawing': 0, kana: 0, hangul: 0 };
  for (const char of name) {
    const cp = char.codePointAt(0)!;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) counts.control++;
    if (cp === 0xfffd) counts.replacement++;
    if ((cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) ||
        (cp >= 0x100000 && cp <= 0x10fffd)) counts['private-use']++;
    if (cp >= 0x2500 && cp <= 0x257f) counts['box-drawing']++;
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xff66 && cp <= 0xff9d)) counts.kana = 1;
    if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) ||
        (cp >= 0xac00 && cp <= 0xd7af)) counts.hangul = 1;
  }
  return {
    score: -20 * (counts.control + counts.replacement) - 10 * counts['private-use'] -
      5 * counts['box-drawing'] + 2 * (counts.kana + counts.hangul),
    reasons: (Object.keys(counts) as NameReason[]).filter(reason => counts[reason] > 0),
  };
}

/**
 * Synchronous, advisory alternatives: scores are string heuristics, not probabilities.
 * Retains original names and paths verbatim; a candidate is no guarantee of path safety.
 * `utf8` is zip.js provenance (including inference/Unicode extras), not strict validation.
 * No candidate or NFC variant is automatically selected by the existing repair flow.
 */
export function getNameCandidates(entry: Pick<ZipEntry, 'name' | 'utf8' | 'rawFilename'>): NameCandidateResult {
  const names = new Map<string, NameCandidate>();
  const diagnostics: NameDiagnostic[] = [];
  const register = (name: string, encodings: NameEncoding[]) => {
    const add = (output: string, normalization: NameSource['normalization']) => {
      let candidate = names.get(output);
      if (!candidate) {
        candidate = { name: output, sources: [], ...assessName(output) };
        names.set(output, candidate);
      }
      for (const encoding of encodings) {
        if (!candidate.sources.some(source => source.encoding === encoding && source.normalization === normalization)) {
          candidate.sources.push({ encoding, normalization });
        }
      }
    };
    add(name, 'none');
    const normalized = name.normalize('NFC');
    if (normalized !== name) add(normalized, 'NFC');
  };
  register(entry.name, ['original']);
  if (!entry.utf8 && entry.rawFilename?.length) {
    for (const encoding of ['shift_jis', 'gb18030', 'big5', 'euc-kr'] as const) {
      let decoder: TextDecoder;
      try { decoder = new TextDecoder(encoding, { fatal: true }); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        diagnostics.push({ encoding, reason: 'unsupported-decoder' });
        continue;
      }
      let decoded: string;
      try { decoded = decoder.decode(entry.rawFilename); }
      catch (error) {
        if (!(error instanceof TypeError)) throw error;
        diagnostics.push({ encoding, reason: 'invalid-bytes' });
        continue;
      }
      // WHATWG GBK decoder delegates to GB18030: one decode, no duplicate score.
      register(decoded, encoding === 'gb18030' ? ['gb18030', 'gbk'] : [encoding]);
    }
    register(decodeCp437(entry.rawFilename), ['cp437']);
  }
  return { candidates: [...names.values()].sort((a, b) => b.score - a.score), diagnostics };
}
