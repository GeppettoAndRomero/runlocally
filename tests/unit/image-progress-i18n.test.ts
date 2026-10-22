import { expect, it } from 'vitest';
import { imageProgress, imageProgressContent, imageProgressLimits, validateImageProgress } from '../../src/i18n/image-progress';

it('owns exact locales, stage keys, strings and limits independently of the tool dictionary', () => {
  expect(Object.keys(imageProgress)).toEqual(['ja', 'en']);
  expect(imageProgressLimits).toEqual({ label: 64, count: 48, processing: 32,
    stages: { reading: 48, decoding: 48, 'heic-decoder-preparing': 64, drawing: 48, encoding: 48 } });
  expect(imageProgressContent('ja')).toBe(imageProgress.ja);
  expect(imageProgress.en.stages).toEqual({ reading: 'Reading', decoding: 'Decoding',
    'heic-decoder-preparing': 'Preparing built-in HEIC decoder', drawing: 'Drawing', encoding: 'Encoding' });
  expect(imageProgress.ja.stages).toEqual({ reading: '読み込み中', decoding: 'デコード中',
    'heic-decoder-preparing': 'HEIC 内蔵デコーダを準備中', drawing: '描画中', encoding: 'エンコード中' });
  for (const content of Object.values(imageProgress)) expect(() => validateImageProgress(content)).not.toThrow();
});
it('rejects missing, extra, blank, overlong and invalid interpolation values', () => {
  const { label: _label, ...missing } = imageProgress.en;
  for (const content of [null, missing, { ...imageProgress.en, extra: 'x' },
    { ...imageProgress.en, label: ' ' }, { ...imageProgress.en, label: '😀'.repeat(65) },
    { ...imageProgress.en, stages: {} }, { ...imageProgress.en, stages: { ...imageProgress.en.stages, extra: 'x' } },
    ...['{done}', '{done} {done}', '{done} {total} {extra}', '{done} {total} {total}', '{done} {total} {broken', '{{done}} {total}'].map(count => ({ ...imageProgress.en, count }))]) {
    expect(() => validateImageProgress(content)).toThrow();
  }
  expect(() => validateImageProgress({ ...imageProgress.en, label: '😀'.repeat(64) })).not.toThrow();
});
