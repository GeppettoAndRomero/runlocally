import type { ImageErrorCode } from '../engine/image/types';
import { LOCALES, type Locale } from './locales';

export interface ImageToolStrings {
  labels: { outputFormat: string; selectImages: string };
  formats: { jpg: string; png: string };
  input: { dropZone: string; idle: string; release: string };
  statuses: { waiting: string; converting: string; saved: string; failed: string };
  notices: {
    metadata: string;
    onDevice: string;
    chrome: string;
    safari: string;
    avif: string;
    heic: string;
  };
  errors: Record<ImageErrorCode, string>;
}

export const imageTool = {
  ja: {
    labels: { outputFormat: '出力形式', selectImages: '画像を選択' },
    formats: { jpg: 'JPG', png: 'PNG' },
    input: { dropZone: '画像をここにドロップするか、ファイルを選択してください。',
      idle: 'ここに画像をドロップ／クリックして選択', release: '放して追加' },
    statuses: { waiting: '待機', converting: '変換中', saved: 'ダウンロード開始', failed: '失敗' },
    notices: {
      metadata: '変換時に再エンコードするため、EXIF・GPS・ICC の情報は出力に引き継がれません。',
      onDevice: '画像は端末内で処理され、サーバーに送信されません。',
      chrome: 'Chrome で複数ファイルのダウンロード許可を求められた場合は、許可してください。',
      safari: 'Safari でダウンロードの確認が表示された場合は、内容を確認して許可してください。',
      avif: 'このブラウザでは AVIF を読み込めません。AVIF の読み込みに対応したブラウザを使用してください。',
      heic: 'HEIC の読み込み機能を初めて使うときは、準備に時間がかかる場合があります。画像は送信されません。',
    },
    errors: {
      'unsupported-type': 'この画像形式には対応していません。',
      'decode-failed': '画像を読み込めませんでした。ファイルを確認してください。',
      'heic-decoder-unavailable': 'HEIC の読み込み機能を準備できませんでした。',
      'too-large': '画像の画素数が上限を超えているため、変換できません。自動縮小は行いません。',
      'out-of-memory': '変換に必要なメモリが不足しています。',
      'encode-failed': '選択した形式の画像を作成できませんでした。',
      interrupted: '変換が中断されました。',
    },
  },
  en: {
    labels: { outputFormat: 'Output format', selectImages: 'Select images' },
    formats: { jpg: 'JPG', png: 'PNG' },
    input: { dropZone: 'Drop images here or select files.',
      idle: 'Drop images here / click to select', release: 'Release to add' },
    statuses: { waiting: 'Waiting', converting: 'Converting', saved: 'Download started', failed: 'Failed' },
    notices: {
      metadata: 'Images are re-encoded during conversion. EXIF, GPS and ICC metadata are not retained in the output.',
      onDevice: 'Images are processed on your device and are not sent to a server.',
      chrome: 'If Chrome asks for permission to download multiple files, allow it.',
      safari: 'If Safari asks you to confirm a download, review the prompt and allow it.',
      avif: 'This browser cannot decode AVIF images. Use a browser that supports AVIF decoding.',
      heic: 'The first use of HEIC decoding may take time to prepare. Your images are not sent anywhere.',
    },
    errors: {
      'unsupported-type': 'This image format is not supported.',
      'decode-failed': 'The image could not be decoded. Check the file.',
      'heic-decoder-unavailable': 'The HEIC decoder could not be initialized.',
      'too-large': 'The image exceeds the pixel limit and cannot be converted. It will not be resized automatically.',
      'out-of-memory': 'There is not enough memory to convert this image.',
      'encode-failed': 'The image could not be encoded in the selected format.',
      interrupted: 'Conversion was interrupted.',
    },
  },
} satisfies Record<Locale, ImageToolStrings>;

const limits = {
  labels: { outputFormat: 32, selectImages: 32 },
  formats: { jpg: 32, png: 32 },
  input: { dropZone: 160, idle: 160, release: 160 },
  statuses: { waiting: 32, converting: 32, saved: 32, failed: 32 },
  notices: { metadata: 240, onDevice: 240, chrome: 240, safari: 240, avif: 240, heic: 240 },
  errors: {
    'unsupported-type': 160, 'decode-failed': 160, 'heic-decoder-unavailable': 160,
    'too-large': 160, 'out-of-memory': 160, 'encode-failed': 160, interrupted: 160,
  },
} satisfies { [Group in keyof ImageToolStrings]: { [Key in keyof ImageToolStrings[Group]]: number } };

function validateContent(content: unknown, schema: object, path: string): void {
  if (!content || typeof content !== 'object' || Object.keys(content).length !== Object.keys(schema).length) {
    throw new Error(`Invalid image tool content: ${path}`);
  }
  for (const [key, rule] of Object.entries(schema)) {
    const value: unknown = Reflect.get(content, key);
    if (!Object.hasOwn(content, key)) throw new Error(`Missing image tool content: ${path}/${key}`);
    if (typeof rule !== 'number') {
      validateContent(value, rule, `${path}/${key}`);
    } else if (typeof value !== 'string' || !value.trim() || Array.from(value).length > rule) {
      throw new Error(`Invalid image tool string: ${path}/${key}`);
    }
  }
}

if (Object.keys(imageTool).length !== LOCALES.length) throw new Error('Unexpected image tool locale');
for (const { code } of LOCALES) validateContent(imageTool[code], limits, code);

export function imageToolContent(locale: Locale): ImageToolStrings {
  const content = imageTool[locale];
  if (!content) throw new Error(`Missing image tool content: ${locale}`);
  return content;
}
