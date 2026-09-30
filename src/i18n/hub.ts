import { LOCALES, type Locale } from './locales';

export interface HubContent {
  title: string;
  description: string;
  h1: string;
  lead: string;
  zipCardTitle: string;
  zipCardDescription: string;
}

export const hubs: Record<Locale, HubContent> = {
  ja: {
    title: 'runlocally | ブラウザでZIPを扱う',
    description: 'ZIPファイルの閲覧、展開、削除、ファイル名の修正をブラウザ内で行えます。',
    h1: 'ブラウザでZIPファイルを扱う',
    lead: 'ZIPの中身を確認し、必要なファイルを展開できます。ファイルの削除や名前の修正もブラウザ内で行えます。',
    zipCardTitle: 'ZIPを開く',
    zipCardDescription: 'ZIPファイルを開いて、中身の確認、展開、削除、ファイル名の修正を行えます。',
  },
  en: {
    title: 'runlocally | Work with ZIP files in your browser',
    description: 'View, extract, remove, and rename files in ZIP archives in your browser.',
    h1: 'Work with ZIP files in your browser',
    lead: 'Open a ZIP archive to view and extract files. You can also remove files and fix their names in your browser.',
    zipCardTitle: 'Open ZIP files',
    zipCardDescription: 'View, extract, remove, and fix file names in a ZIP archive.',
  },
};

const keys = ['title', 'description', 'h1', 'lead', 'zipCardTitle', 'zipCardDescription'] as const;
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
