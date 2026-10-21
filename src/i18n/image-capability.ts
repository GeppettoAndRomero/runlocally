import { LOCALES, type Locale } from './locales';
import type { NativeImageFormat } from '../engine/image/probe';

export interface ImageCapabilityStrings {
  heading: string;
  formats: Record<NativeImageFormat, string>;
  checking: string;
  readable: string;
  unreadable: string;
  heic: string;
  fallback: string;
  note: string;
}
export const imageCapability = {
  ja: {
    heading: 'このブラウザで読み込める形式',
    formats: { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', ico: 'ICO', avif: 'AVIF' },
    checking: '確認中…', readable: '読める', unreadable: '読めない', heic: 'HEIC／HEIF',
    fallback: '対応（ブラウザが読めなければ端末内の内蔵デコーダで処理）',
    note: '極小のサンプル画像で確認した結果です。巨大な画像、特殊な符号化、破損した画像などの読み込みや変換成功を保証しません。HEIC／HEIF の対応表示も処理経路の存在を示し、すべてのファイルの成功を保証しません。',
  },
  en: {
    heading: 'Formats readable in this browser',
    formats: { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', ico: 'ICO', avif: 'AVIF' },
    checking: 'Checking…', readable: 'Readable', unreadable: 'Not readable', heic: 'HEIC / HEIF',
    fallback: 'Supported (processed by the built-in on-device decoder if the browser cannot read it)',
    note: 'These results use tiny sample images. They do not guarantee reading or conversion of large images, unusual encodings, damaged images or other files. HEIC / HEIF support indicates a processing path, not guaranteed success for every file.',
  },
} satisfies Record<Locale, ImageCapabilityStrings>;
export const imageCapabilityLimits = {
  heading: 64, formats: { png: 16, jpeg: 16, gif: 16, webp: 16, bmp: 16, ico: 16, avif: 16 },
  checking: 24, readable: 24, unreadable: 24, heic: 24, fallback: 160, note: 320,
} satisfies { [Key in keyof ImageCapabilityStrings]: ImageCapabilityStrings[Key] extends string
  ? number : Record<NativeImageFormat, number> };
export function validateImageCapability(content: unknown, schema: object = imageCapabilityLimits): void {
  if (!content || typeof content !== 'object' || Object.keys(content).length !== Object.keys(schema).length) {
    throw new Error('Invalid image capability keys');
  }
  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.hasOwn(content, key)) throw new Error('Missing image capability key');
    const value: unknown = Reflect.get(content, key);
    if (typeof rule !== 'number') validateImageCapability(value, rule);
    else if (typeof value !== 'string' || !value.trim() || Array.from(value).length > rule) {
      throw new Error('Invalid image capability string');
    }
  }
}
if (Object.keys(imageCapability).length !== LOCALES.length) throw new Error('Unexpected image capability locale');
for (const { code } of LOCALES) validateImageCapability(imageCapability[code]);
export function imageCapabilityContent(locale: Locale): ImageCapabilityStrings {
  return imageCapability[locale];
}
