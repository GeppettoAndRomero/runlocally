import { LOCALES, type Locale } from './locales';
import type { ImageStage } from '../engine/image/convert';

export interface ImageProgressStrings {
  label: string;
  count: string;
  processing: string;
  stages: Record<ImageStage, string>;
}
export const imageProgress = {
  ja: { label: '変換の進捗', count: '{done} / {total} 枚', processing: '処理中: ',
    stages: { reading: '読み込み中', decoding: 'デコード中', 'heic-decoder-preparing': 'HEIC 内蔵デコーダを準備中', drawing: '描画中', encoding: 'エンコード中' } },
  en: { label: 'Conversion progress', count: '{done} / {total} files', processing: 'Processing: ',
    stages: { reading: 'Reading', decoding: 'Decoding', 'heic-decoder-preparing': 'Preparing built-in HEIC decoder', drawing: 'Drawing', encoding: 'Encoding' } },
} satisfies Record<Locale, ImageProgressStrings>;
export const imageProgressLimits = {
  label: 64, count: 48, processing: 32,
  stages: { reading: 48, decoding: 48, 'heic-decoder-preparing': 64, drawing: 48, encoding: 48 },
} satisfies { [Key in keyof ImageProgressStrings]: ImageProgressStrings[Key] extends string ? number : Record<ImageStage, number> };
export function validateImageProgress(content: unknown, schema: object = imageProgressLimits): void {
  if (!content || typeof content !== 'object' || Object.keys(content).length !== Object.keys(schema).length) {
    throw new Error('Invalid image progress keys');
  }
  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.hasOwn(content, key)) throw new Error('Missing image progress key');
    const value: unknown = Reflect.get(content, key);
    if (typeof rule !== 'number') validateImageProgress(value, rule);
    else if (typeof value !== 'string' || !value.trim() || Array.from(value).length > rule ||
      (key === 'count' && (value.match(/\{[^{}]*\}/g)?.sort().join() !== '{done},{total}' ||
        /[{}]/.test(value.replace('{done}', '').replace('{total}', ''))))) {
      throw new Error('Invalid image progress string');
    }
  }
}
if (Object.keys(imageProgress).length !== LOCALES.length) throw new Error('Unexpected image progress locale');
for (const { code } of LOCALES) validateImageProgress(imageProgress[code]);
export function imageProgressContent(locale: Locale): ImageProgressStrings { return imageProgress[locale]; }
