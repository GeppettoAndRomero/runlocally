import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n/locales';
import { AVAILABLE_OPS, ZIP_SLUGS, type AvailableOpId } from '../i18n/ops';

export type ZipPage = 'top' | AvailableOpId;
export type PublicPage = 'hub' | ZipPage;
export type UnlistedPage = 'image';
export type SitePage = PublicPage | UnlistedPage;
export type PageRoute<Page extends SitePage = PublicPage> = { locale: Locale; page: Page };

export const ZIP_PAGES: readonly ZipPage[] = ['top', ...AVAILABLE_OPS.map(op => op.id)];
export const PUBLIC_PAGES: readonly PublicPage[] = ['hub', ...ZIP_PAGES];

// PUBLIC is indexable; SITE also includes unlisted pages. Unlisted pages are generated but excluded from indexing.
export const UNLISTED_PAGES: readonly UnlistedPage[] = ['image'];
export const SITE_PAGES: readonly SitePage[] = [...PUBLIC_PAGES, ...UNLISTED_PAGES];

const availableSlugs = new Map<string, string>(AVAILABLE_OPS.map(op => [op.id, ZIP_SLUGS[op.id]]));

// Internal test seam: each model owns its registry and never changes the production model.
export function __createUrlModel(unlistedPages: readonly UnlistedPage[]) {
  const sitePages: readonly SitePage[] = [...PUBLIC_PAGES, ...unlistedPages];

  function pagePath(locale: Locale, page: SitePage): string {
    if (!LOCALES.some(entry => entry.code === locale)) throw new Error(`Unknown locale: ${locale}`);
    if (!sitePages.includes(page)) throw new Error(`Unavailable page: ${page}`);

    const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
    if (page === 'hub') return `${prefix}/`;
    if (page === 'image') return `${prefix}/image/`;
    if (page === 'top') return `${prefix}/zip/`;
    return `${prefix}/zip/${availableSlugs.get(page)}/`;
  }

  const routes = new Map<string, PageRoute<SitePage>>(
    LOCALES.flatMap(({ code }) => sitePages.map(page => [pagePath(code, page), { locale: code, page }] as const)),
  );

  function sitePageFromPath(pathname: string): PageRoute<SitePage> | undefined {
    return routes.get(pathname);
  }

  function isIndexable(page: SitePage): page is PublicPage {
    return PUBLIC_PAGES.some(entry => entry === page);
  }

  function publicPageFromPath(pathname: string): PageRoute | undefined {
    const route = sitePageFromPath(pathname);
    if (!route || !isIndexable(route.page)) return undefined;
    return { locale: route.locale, page: route.page };
  }

  function zipPageFromPath(pathname: string): PageRoute<ZipPage> | undefined {
    const route = publicPageFromPath(pathname);
    if (!route || route.page === 'hub') return undefined;
    return { locale: route.locale, page: route.page };
  }

  return { sitePages, pagePath, sitePageFromPath, publicPageFromPath, zipPageFromPath, isIndexable };
}

export const { pagePath, sitePageFromPath, publicPageFromPath, zipPageFromPath, isIndexable } =
  __createUrlModel(UNLISTED_PAGES);
export type UrlModel = ReturnType<typeof __createUrlModel>;
