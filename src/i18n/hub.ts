import { LOCALES, type Locale } from './locales';

export interface HubContent {
  title: string;
  description: string;
  h1: string;
  lead: string;
  zipCardTitle: string;
  zipCardDescription: string;
  imageCardTitle: string;
  imageCardDescription: string;
}

export const hubs: Record<Locale, HubContent> = {
  ja: {
    title: 'runlocally | ブラウザでZIPを扱う',
    description: 'ZIPファイルの閲覧、展開、削除、ファイル名の修正、作成をブラウザ内で行えます。',
    h1: 'ブラウザでZIPファイルを扱う',
    lead: 'ZIPの中身を確認し、必要なファイルを展開できます。ZIP の作成、ファイルの削除や名前の修正もブラウザ内で行えます。',
    imageCardTitle: '画像変換（準備中）',
    imageCardDescription: 'WebP・HEIC などの画像を JPG／PNG に端末内で変換する機能を提供する予定です。',
    zipCardTitle: 'ZIPを開く',
    zipCardDescription: 'ZIPファイルを開いて、中身の確認、展開、削除、ファイル名の修正や、新しい ZIP の作成を行えます。',
  },
  en: {
    title: 'runlocally | Work with ZIP files in your browser',
    description: 'View, extract, remove, and rename ZIP entries, or create ZIP files in your browser.',
    h1: 'Work with ZIP files in your browser',
    lead: 'Open a ZIP archive to view and extract files. You can also create ZIP files, remove entries and fix their names in your browser.',
    imageCardTitle: 'Image conversion (coming soon)',
    imageCardDescription: 'We plan to offer on-device conversion of images such as WebP and HEIC to JPG or PNG.',
    zipCardTitle: 'Open ZIP files',
    zipCardDescription: 'View, extract, remove, and fix file names in a ZIP archive, or create a new ZIP.',
  },
};

const keys = ['title', 'description', 'h1', 'lead', 'zipCardTitle', 'zipCardDescription', 'imageCardTitle', 'imageCardDescription'] as const;
if (Object.keys(hubs).length !== LOCALES.length) throw new Error('Unexpected hub locale');
for (const { code } of LOCALES) {
  const content = hubs[code];
  if (!content || Object.keys(content).length !== keys.length ||
    !keys.every(key => typeof content[key] === 'string' && content[key].trim())) {
    throw new Error(`Missing hub content: ${code}`);
  }
}

export function hubContent(locale: Locale): HubContent {
  const content = hubs[locale];
  if (!content) throw new Error(`Missing hub content: ${locale}`);
  return content;
}
