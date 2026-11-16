import { afterEach, expect, it, vi } from 'vitest';
import { decodeCp437 } from '../../src/engine/zip/cp437';
import { decodeShiftJisName, getNameCandidates } from '../../src/engine/zip/names';
import { repairedName } from '../../src/app/rewrite-plan';
import { nameCases } from '../fixtures/zip/names/fixtures';
const entry = (name = 'original', rawFilename?: Uint8Array, utf8 = false) => ({ name, rawFilename, utf8 });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it.each(nameCases)('generates $encoding from independent bytes', ({ encoding, name, bytes }) => {
  const result = getNameCandidates(entry('original', new Uint8Array(bytes)));
  expect(result.candidates.find(candidate => candidate.name === name)?.sources).toContainEqual({ encoding, normalization: 'none' });
  if (encoding === 'gbk' || encoding === 'gb18030') {
    expect(result.candidates.find(candidate => candidate.name === name)).toMatchObject({ score: 0,
      sources: expect.arrayContaining([{ encoding: 'gb18030', normalization: 'none' }, { encoding: 'gbk', normalization: 'none' }]) });
  }
});
it('merges ASCII sources once and keeps original and CP437 evidence', () => {
  const result = getNameCandidates(entry('abc', new TextEncoder().encode('abc')));
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].sources.map(source => source.encoding)).toEqual(['original', 'shift_jis', 'gb18030', 'gbk', 'big5', 'euc-kr', 'cp437']);
  expect(getNameCandidates(entry('café.txt', new Uint8Array(nameCases[1].bytes))).candidates
    .find(candidate => candidate.name === 'café.txt')?.sources).toEqual([
      { encoding: 'original', normalization: 'none' }, { encoding: 'cp437', normalization: 'none' },
    ]);
});
it('maps every low CP437 code literally and checks high boundaries and representative values', () => {
  expect(decodeCp437(Uint8Array.from({ length: 128 }, (_, i) => i))).toBe(String.fromCharCode(...Array.from({ length: 128 }, (_, i) => i)));
  expect(decodeCp437(new Uint8Array([0x80, 0x82, 0x9f, 0xb0, 0xc4, 0xdb, 0xe0, 0xff]))).toBe('Çéƒ░─█α ');
});
it.each([undefined, new Uint8Array()])('skips legacy decoding for absent/empty bytes', raw => {
  expect(getNameCandidates(entry('か\u3099.txt', raw)).candidates.map(c => c.name)).toEqual(['か\u3099.txt', 'が.txt']);
});
it('retains NFC, directories, compatibility forms, unsafe paths and UTF-8 provenance', () => {
  for (const name of ['が.txt', 'dir/', '①.txt', '../bad\u0000', '/absolute']) {
    expect(getNameCandidates(entry(name, new Uint8Array([0xff]), true)).candidates).toHaveLength(1);
    expect(getNameCandidates(entry(name, undefined)).candidates[0].name).toBe(name);
  }
  const first = entry('か\u3099/'), second = entry('が/');
  expect(getNameCandidates(first).candidates.map(c => c.name)).toEqual(['か\u3099/', 'が/']);
  expect(getNameCandidates(second).candidates[0].name).toBe('が/');
  expect([first.name, second.name]).toEqual(['か\u3099/', 'が/']);
});
it('keeps inputs immutable, repeatable and original first on ties; never applies the highest score', () => {
  const raw = new Uint8Array(nameCases[0].bytes), saved = raw.slice();
  const input = Object.freeze(entry('\ufffd', raw));
  const result = getNameCandidates(input);
  expect(getNameCandidates(input)).toEqual(result);
  expect(raw).toEqual(saved);
  expect(input.name).toBe('\ufffd');
  expect(result.candidates[0].name).not.toBe(input.name);
  expect(repairedName({ ...input, directory: false, size: 0, compressedSize: 0, encrypted: false })).toBe(decodeShiftJisName(input));
  const ambiguous = getNameCandidates(entry('漢字', new Uint8Array(nameCases[2].bytes)));
  expect(ambiguous.candidates.filter(c => c.score === 0).map(c => c.name)[0]).toBe('漢字');
  expect(ambiguous.candidates.find(c => c.name === '中文.txt')?.score).toBe(0);
});
it.each([
  ['\u0000\u001f\u007f\u009f', -80, ['control']], ['\ufffd\ufffd', -40, ['replacement']],
  ['\ue000\uf8ff\u{f0000}\u{ffffd}\u{100000}\u{10fffd}', -60, ['private-use']],
  ['\u2500\u257f', -10, ['box-drawing']], ['かなｦ', 2, ['kana']], ['ᄀㄱ한글', 2, ['hangul']],
  ['\u0000\ufffd\ue000─か한', -51, ['control', 'replacement', 'private-use', 'box-drawing', 'kana', 'hangul']],
] as const)('scores %s by output code points', (name, score, reasons) => {
  expect(getNameCandidates(entry(name)).candidates[0]).toMatchObject({ score, reasons });
});
it('reports invalid bytes and continues through CP437', () => {
  // 0xE0 is a multibyte lead in Shift_JIS, GB18030, Big5 and EUC-KR (including UHC).
  // Without a trailing byte, all four fatal decoders must reject the incomplete sequence.
  const result = getNameCandidates(entry('original', new Uint8Array([0xe0])));
  expect(result.diagnostics).toEqual(['shift_jis', 'gb18030', 'big5', 'euc-kr'].map(encoding => ({ encoding, reason: 'invalid-bytes' })));
  expect(result.candidates.some(c => c.sources.some(s => s.encoding === 'cp437'))).toBe(true);
});
it('can import with Shift_JIS unsupported and does not cache failure', async () => {
  const Native = TextDecoder;
  vi.stubGlobal('TextDecoder', class extends Native {
    constructor(label?: string, options?: TextDecoderOptions) {
      if (label === 'shift_jis' || label === 'shift-jis') throw new RangeError('unsupported');
      super(label, options);
    }
  });
  const api = await import('../../src/engine/zip/names');
  const input = entry('original', new Uint8Array(nameCases[0].bytes));
  expect(api.getNameCandidates(input).diagnostics).toContainEqual({ encoding: 'shift_jis', reason: 'unsupported-decoder' });
  expect(api.getNameCandidates(input).candidates.some(c => c.sources.some(s => s.encoding === 'cp437'))).toBe(true);
  expect(api.decodeShiftJisName(entry('early', undefined, true))).toBe('early');
  vi.unstubAllGlobals();
  expect(api.getNameCandidates(input).candidates.some(c => c.name === nameCases[0].name)).toBe(true);
});
it.each(['construct', 'decode'])('propagates unexpected %s failures', stage => {
  vi.stubGlobal('TextDecoder', class {
    constructor() { if (stage === 'construct') throw new Error('unexpected'); }
    decode() { throw new RangeError('unexpected'); }
  });
  expect(() => getNameCandidates(entry('original', new Uint8Array([1])))).toThrow('unexpected');
});
it.each(['shift_jis', 'gb18030', 'big5', 'euc-kr'])('isolates unsupported %s and uses strict decoders once', unsupported => {
  const Native = TextDecoder, calls: string[] = [];
  vi.stubGlobal('TextDecoder', class extends Native {
    constructor(label?: string, options?: TextDecoderOptions) {
      calls.push(label!);
      expect(options).toEqual({ fatal: true });
      if (label === unsupported) throw new RangeError('unsupported');
      super(label, options);
    }
  });
  const result = getNameCandidates(entry('abc', new TextEncoder().encode('abc')));
  expect(calls).toEqual(['shift_jis', 'gb18030', 'big5', 'euc-kr']);
  expect(result.diagnostics).toEqual([{ encoding: unsupported, reason: 'unsupported-decoder' }]);
  expect(result.candidates[0].sources).toContainEqual({ encoding: 'cp437', normalization: 'none' });
});
it('registers each decoded NFC directly after its unnormalized name and preserves source', () => {
  vi.stubGlobal('TextDecoder', class { decode() { return 'か\u3099.txt'; } });
  const result = getNameCandidates(entry('original', new Uint8Array([1])));
  const names = result.candidates.map(c => c.name);
  expect(names.slice(0, 2)).toEqual(['か\u3099.txt', 'が.txt']);
  expect(result.candidates[1].sources).toEqual(['shift_jis', 'gb18030', 'gbk', 'big5', 'euc-kr']
    .map(encoding => ({ encoding, normalization: 'NFC' })));
});
