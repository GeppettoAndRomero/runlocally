import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n/locales';
import { AVAILABLE_OPS, ZIP_SLUGS, type AvailableOpId } from '../i18n/ops';

export type ZipPage = 'top' | AvailableOpId;
export type PublicPage = 'hub' | ZipPage;
export type PageRoute<Page extends PublicPage = PublicPage> = { locale: Locale; page: Page };

export const ZIP_PAGES: readonly ZipPage[] = ['top', ...AVAILABLE_OPS.map(op => op.id)];
export const PUBLIC_PAGES: readonly PublicPage[] = ['hub', ...ZIP_PAGES];

const availableSlugs = new Map<string, string>(AVAILABLE_OPS.map(op => [op.id, ZIP_SLUGS[op.id]]));

export function pagePath(locale: Locale, page: PublicPage): string {
  if (!LOCALES.some(entry => entry.code === locale)) throw new Error(`Unknown locale: ${locale}`);
  if (!PUBLIC_PAGES.includes(page)) throw new Error(`Unavailable page: ${page}`);

  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  if (page === 'hub') return `${prefix}/`;
  if (page === 'top') return `${prefix}/zip/`;
  return `${prefix}/zip/${availableSlugs.get(page)}/`;
}

const routes = new Map<string, PageRoute>(
  LOCALES.flatMap(({ code }) => PUBLIC_PAGES.map(page => [pagePath(code, page), { locale: code, page }] as const)),
);

export function publicPageFromPath(pathname: string): PageRoute | undefined {
  return routes.get(pathname);
}

export function zipPageFromPath(pathname: string): PageRoute<ZipPage> | undefined {
  const route = publicPageFromPath(pathname);
  if (!route || route.page === 'hub') return undefined;
  return { locale: route.locale, page: route.page };
}
