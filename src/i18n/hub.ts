import { checkMetadataLength } from '../seo/page';
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
    title: 'runlocally | ZIP操作と画像変換',
    description: 'ZIPの閲覧・展開・削除・名前修正・作成と、画像のJPG／PNGへの変換を端末内で行えます。',
    h1: 'ブラウザでZIP操作と画像変換',
    lead: 'ZIPの閲覧・展開・削除・名前修正・作成と、画像のJPG／PNGへの変換をブラウザ内で行えます。ファイルは送信しません。',
    imageCardTitle: '画像変換',
    imageCardDescription: 'WebP・HEIC などの画像を端末内で JPG／PNG に変換します。入力形式の対応はブラウザに依存します。',
    zipCardTitle: 'ZIPを開く',
    zipCardDescription: 'ZIPファイルを開いて、中身の確認、展開、削除、ファイル名の修正や、新しい ZIP の作成を行えます。',
  },
  en: {
    title: 'runlocally | ZIP tools and image conversion',
    description: 'View, extract, remove, rename or create ZIP files, and convert images to JPG or PNG on your device.',
    h1: 'ZIP tools and image conversion in your browser',
    lead: 'View, extract, remove or rename ZIP entries, create ZIP files, and convert images to JPG or PNG in your browser. Files stay on your device.',
    imageCardTitle: 'Image conversion',
    imageCardDescription: 'Convert images such as WebP and HEIC to JPG or PNG on your device. Input support depends on your browser.',
    zipCardTitle: 'Open ZIP files',
    zipCardDescription: 'View, extract, remove, and fix file names in a ZIP archive, or create a new ZIP.',
  },
};

const keys = ['title', 'description', 'h1', 'lead', 'zipCardTitle', 'zipCardDescription', 'imageCardTitle', 'imageCardDescription'] as const;
export function validateHubs(hubs: Record<Locale, HubContent>): void {
  if (Object.keys(hubs).length !== LOCALES.length) throw new Error('Unexpected hub locale');
  for (const { code } of LOCALES) {
    const content = hubs[code];
    if (!content || Object.keys(content).length !== keys.length ||
      !keys.every(key => typeof content[key] === 'string' && content[key].trim())) {
      throw new Error(`Missing hub content: ${code}`);
    }
    checkMetadataLength(code, 'hub', content.title, content.description);
  }
}

validateHubs(hubs);

export function hubContent(locale: Locale): HubContent {
  const content = hubs[locale];
  if (!content) throw new Error(`Missing hub content: ${locale}`);
  return content;
}
