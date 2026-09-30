import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { OPS } from '../../src/i18n/ops';
import { pageContent, pages } from '../../src/i18n/pages';
import { pagePath, publicPageFromPath, publicPageFromUrl, SITE_ORIGIN } from '../../src/seo/page';
import { ZIP_PAGES } from '../../src/seo/url-model';

describe('public routing and dictionaries', () => {
  it('round trips every locale and available page without a default prefix', () => {
    for (const { code } of LOCALES) {
      expect(pages[code]).toBeDefined();
      for (const page of ZIP_PAGES) {
        const path = pagePath(code, page);
        expect(publicPageFromPath(path)).toEqual({ locale: code, page });
        expect(publicPageFromUrl(`${SITE_ORIGIN}${path}`)).toEqual({ locale: code, page });
        expect(pageContent(code, page).h1).toBeTruthy();
      }
    }
    expect(publicPageFromPath('/ja/')).toBeUndefined();
  });

  it('accepts preview paths but excludes unknown and unavailable routes', () => {
    const extractPath = pagePath('en', 'extract');
    expect(publicPageFromPath(new URL(extractPath, 'http://localhost:4321').pathname)).toEqual({ locale: 'en', page: 'extract' });
    for (const op of OPS.filter(item => !item.available)) expect(publicPageFromPath(`/${op.slug}/`)).toBeUndefined();
    for (const path of ['/fr/', '/unzip/ja/', '/en/unknown/', extractPath.slice(0, -1), `${extractPath}extra/`]) {
      expect(publicPageFromPath(path)).toBeUndefined();
    }
  });
});
