import { describe, expect, it } from 'vitest';
import { LOCALES, DEFAULT_LOCALE } from '../../src/i18n/locales';
import { AVAILABLE_OPS, OPS } from '../../src/i18n/ops';
import { pageContent, pages } from '../../src/i18n/pages';
import { pagePath, publicPageFromPath, publicPageFromUrl, SITE_ORIGIN, type PublicPage } from '../../src/seo/page';

describe('public routing and dictionaries', () => {
  it('round trips every locale and available page without a default prefix', () => {
    for (const { code } of LOCALES) {
      expect(pages[code]).toBeDefined();
      for (const page of ['top', ...AVAILABLE_OPS.map(op => op.id)] as PublicPage[]) {
        const path = pagePath(code, page);
        expect(publicPageFromPath(path)).toEqual({ locale: code, page });
        expect(publicPageFromUrl(`${SITE_ORIGIN}${path}`)).toEqual({ locale: code, page });
        expect(pageContent(code, page).h1).toBeTruthy();
      }
    }
    expect(pagePath(DEFAULT_LOCALE, 'top')).toBe('/');
    expect(publicPageFromPath('/ja/')).toBeUndefined();
  });

  it('accepts preview paths but excludes unknown and unavailable routes', () => {
    expect(publicPageFromPath(new URL('http://localhost:4321/en/unzip/').pathname)).toEqual({ locale: 'en', page: 'extract' });
    for (const op of OPS.filter(item => !item.available)) expect(publicPageFromPath(`/${op.slug}/`)).toBeUndefined();
    for (const path of ['/fr/', '/unzip/ja/', '/en/unknown/', '/en/unzip', '/en/unzip/extra/']) {
      expect(publicPageFromPath(path)).toBeUndefined();
    }
  });
});
