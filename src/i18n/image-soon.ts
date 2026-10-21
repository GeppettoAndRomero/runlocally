import { LOCALES, type Locale } from './locales';

export interface ImageSoonContent {
  title: string;
  description: string;
  h1: string;
  lead: string;
  body: string;
  hubLink: string;
  zipLink: string;
}

export const imageSoon: Record<Locale, ImageSoonContent> = {
  ja: {
    title: '画像変換（準備中） | runlocally',
    description: '画像変換ツールは準備中です。WebP・HEIC などを JPG／PNG に端末内で変換する機能を提供する予定です。',
    h1: '画像変換（準備中）',
    lead: '画像変換ツールは準備中です。',
    body: 'WebP・HEIC などの画像を JPG／PNG に端末内で変換する機能を提供する予定です。',
    hubLink: 'ホームに戻る',
    zipLink: 'ZIP ツールを開く',
  },
  en: {
    title: 'Image conversion (coming soon) | runlocally',
    description: 'Image conversion is coming soon. We plan to offer on-device conversion from WebP and HEIC to JPG or PNG.',
    h1: 'Image conversion (coming soon)',
    lead: 'The image conversion tool is coming soon.',
    body: 'We plan to offer on-device conversion of images such as WebP and HEIC to JPG or PNG.',
    hubLink: 'Back to home',
    zipLink: 'Open the ZIP tool',
  },
};

const keys = ['title', 'description', 'h1', 'lead', 'body', 'hubLink', 'zipLink'] as const;
if (Object.keys(imageSoon).length !== LOCALES.length) throw new Error('Unexpected image locale');
for (const { code } of LOCALES) {
  const content = imageSoon[code];
  if (!content || Object.keys(content).length !== keys.length ||
    !keys.every(key => typeof content[key] === 'string' && content[key].trim())) {
    throw new Error(`Missing image content: ${code}`);
  }
}

export function imageSoonContent(locale: Locale): ImageSoonContent {
  const content = imageSoon[locale];
  if (!content) throw new Error(`Missing image content: ${locale}`);
  return content;
}
