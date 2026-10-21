import { LOCALES, type Locale } from './locales';

export interface ImagePageContent {
  title: string;
  description: string;
  h1: string;
  lead: string;
  body: string;
  hubLink: string;
  zipLink: string;
}

export const imagePage: Record<Locale, ImagePageContent> = {
  ja: {
    title: '画像変換 | runlocally',
    description: '画像を端末内で JPG／PNG に変換し、自動ダウンロードを開始します。ファイルはアップロードしません。',
    h1: '画像変換',
    lead: '画像を端末内で JPG／PNG に変換します。',
    body: '画像を選ぶと個別に自動ダウンロードを開始します。入力形式の対応はブラウザに依存します。JPG の透過部分は白背景になります。保存完了はブラウザや OS で確認してください。',
    hubLink: 'ホームに戻る',
    zipLink: 'ZIP ツールを開く',
  },
  en: {
    title: 'Image conversion | runlocally',
    description: 'Convert images to JPG or PNG on your device and start automatic downloads. No files are uploaded.',
    h1: 'Image conversion',
    lead: 'Convert images to JPG or PNG on your device.',
    body: 'Select images to start individual automatic downloads. Input support depends on your browser. JPG uses a white background for transparency. Check your browser or OS for save completion.',
    hubLink: 'Back to home',
    zipLink: 'Open the ZIP tool',
  },
};

const keys = ['title', 'description', 'h1', 'lead', 'body', 'hubLink', 'zipLink'] as const;
if (Object.keys(imagePage).length !== LOCALES.length) throw new Error('Unexpected image locale');
for (const { code } of LOCALES) {
  const content = imagePage[code];
  if (!content || Object.keys(content).length !== keys.length ||
    !keys.every(key => typeof content[key] === 'string' && content[key].trim())) {
    throw new Error(`Missing image content: ${code}`);
  }
}

export function imagePageContent(locale: Locale): ImagePageContent {
  const content = imagePage[locale];
  if (!content) throw new Error(`Missing image content: ${locale}`);
  return content;
}
