import { LOCALES, type Locale } from './locales';

export interface NotFoundContent {
  title: string;
  heading: string;
  body: string;
  hubLink: string;
  zipLink: string;
}

export const notFound: Record<Locale, NotFoundContent> = {
  ja: {
    title: 'ページが見つかりません | runlocally',
    heading: 'ページが見つかりません',
    body: 'お探しのページは存在しないか、移動しました。',
    hubLink: 'ホームに戻る',
    zipLink: 'ZIP ツールを開く',
  },
  en: {
    title: 'Page not found | runlocally',
    heading: 'Page not found',
    body: 'The page you requested does not exist or has moved.',
    hubLink: 'Back to home',
    zipLink: 'Open the ZIP tool',
  },
};

const keys = ['title', 'heading', 'body', 'hubLink', 'zipLink'] as const;
export function validateNotFound(content: Record<Locale, NotFoundContent>): void {
  if (Object.keys(content).length !== LOCALES.length) throw new Error('Unexpected not-found locale');
  for (const { code } of LOCALES) {
    const entry = content[code];
    if (!entry || Object.keys(entry).length !== keys.length ||
      !keys.every(key => typeof entry[key] === 'string' && entry[key].trim())) {
      throw new Error(`Missing not-found content: ${code}`);
    }
  }
}

validateNotFound(notFound);

export function notFoundContent(locale: Locale): NotFoundContent {
  const content = notFound[locale];
  if (!content) throw new Error(`Missing not-found content: ${locale}`);
  return content;
}
