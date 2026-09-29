import { LOCALES, type Locale } from './locales';
import { AVAILABLE_OPS } from './ops';
import type { PageContent } from './types';
import type { PublicPage } from '../seo/page';

const modules = import.meta.glob<{ pages: Record<string, PageContent> }>('./*/pages.ts', { eager: true });
export const pages = Object.fromEntries(LOCALES.map(({ code }) => {
  const dictionary = modules[`./${code}/pages.ts`]?.pages;
  if (!dictionary) throw new Error(`Missing page dictionary: ${code}`);
  for (const key of ['top', ...AVAILABLE_OPS.map(op => op.i18nKey)]) {
    const content = dictionary[key];
    if (!content || !['title', 'description', 'h1', 'lead'].every(field =>
      typeof content[field as keyof PageContent] === 'string' && String(content[field as keyof PageContent]).trim()) ||
      !Array.isArray(content.steps) || !content.steps.length || !Array.isArray(content.faq) || !content.faq.length ||
      !Array.isArray(content.limits) || !content.limits.length) throw new Error(`Missing page content: ${code}/${key}`);
  }
  return [code, dictionary];
})) as Record<Locale, Record<string, PageContent>>;

export function pageContent(locale: Locale, page: PublicPage): PageContent {
  const key = page === 'top' ? 'top' : AVAILABLE_OPS.find(op => op.id === page)?.i18nKey;
  const content = key && pages[locale]?.[key];
  if (!content) throw new Error(`Missing page content: ${locale}/${page}`);
  return content;
}
