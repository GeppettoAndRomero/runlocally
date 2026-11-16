import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { repository } from '../../package.json';
import { aboutContent, abouts, validateAbouts, type AboutContent } from '../../src/i18n/about';
import { LOCALES } from '../../src/i18n/locales';
import { headData, publicPageFromUrl, SITE_ORIGIN } from '../../src/seo/page';
import { PUBLIC_PAGES, SITE_PAGES, pagePath, publicPageFromPath, sitePageFromPath, zipPageFromPath } from '../../src/seo/url-model';
import { transformPrecache } from '../../scripts/pwa-manifest.mjs';
import { addBuildMetaToOutput } from '../../scripts/build-meta.mjs';

// Independent expectations: do not derive the expected URL set from the registry under test.
const publicPaths = ['/', '/about/', '/zip/', '/zip/view/', '/zip/extract/', '/zip/remove/', '/zip/fix-names/', '/zip/create/',
  '/en/', '/en/about/', '/en/zip/', '/en/zip/view/', '/en/zip/extract/', '/en/zip/remove/', '/en/zip/fix-names/', '/en/zip/create/'];
const sitePaths = [...publicPaths, '/image/', '/en/image/'];
const aboutPaths = ['/about/', '/en/about/'];
const keys = ['title', 'description', 'h1', 'lead', 'operation', 'disclosure', 'verificationHeading', 'verificationSteps',
  'linksHeading', 'sourceLink', 'issuesLink', 'securityLink', 'securityNote', 'footerLink'];
const clone = () => structuredClone(abouts);
const filePath = (path: string) => `${path.slice(1)}index.html`;
const read = (path: string) => readFileSync(join('dist', filePath(path)), 'utf8');
const withDocument = (source: string, check: (document: Document) => void, xml = false) => {
  const dom = new JSDOM(source, xml ? { contentType: 'application/xml' } : {});
  try { check(dom.window.document); } finally { dom.window.close(); }
};

describe('c370-about dictionary and URL boundary', () => {
  it('requires the exact locales, keys, nonblank strings and four complete steps', () => {
    expect(Object.keys(abouts).sort()).toEqual(['en', 'ja']);
    for (const { code } of LOCALES) {
      expect(Object.keys(aboutContent(code)).sort()).toEqual([...keys].sort());
      expect(aboutContent(code).verificationSteps).toHaveLength(4);
      for (const key of keys) {
        const value = clone();
        Reflect.deleteProperty(value[code], key);
        expect(() => validateAbouts(value), key).toThrow();
        Reflect.set(value[code], key, key === 'verificationSteps' ? ['a', 'b', 'c', ' '] : ' ');
        expect(() => validateAbouts(value), key).toThrow();
      }
      for (const steps of [[], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 1], Array(4)]) {
        const value = clone();
        Reflect.set(value[code], 'verificationSteps', steps);
        expect(() => validateAbouts(value)).toThrow();
      }
      const extra = clone();
      Reflect.set(extra[code], 'unknown', 'extra');
      expect(() => validateAbouts(extra)).toThrow();
    }
    for (const mode of ['missing', 'extra', 'replacement']) {
      const value = clone();
      if (mode !== 'extra') Reflect.deleteProperty(value, 'en');
      if (mode !== 'missing') Reflect.set(value, 'fr', abouts.en);
      expect(() => validateAbouts(value)).toThrow();
    }
    expect(() => Reflect.apply(aboutContent, undefined, ['fr'])).toThrow();
  });

  it('validates Unicode code point boundaries in the dictionary and final head', () => {
    for (const { code } of LOCALES) for (const [key, limit] of [['title', 60], ['description', 120]] as const) {
      for (const length of [limit - 1, limit]) {
        const value = clone();
        value[code][key] = '😀'.repeat(length);
        expect(() => validateAbouts(value)).not.toThrow();
        expect(() => headData(code, 'about', value[code])).not.toThrow();
      }
      const oversized = clone();
      oversized[code][key] = '😀'.repeat(limit + 1);
      const lengthError = `${code}/about ${key}: ${limit + 1} code points (limit ${limit}; nonblank required)`;
      expect(() => validateAbouts(oversized)).toThrow(lengthError);
      expect(() => headData(code, 'about', oversized[code])).toThrow(lengthError);
      // Dictionary shape/nonblank validation precedes metadata lengths; headData checks metadata directly.
      for (const invalid of ['', '  ']) {
        const value = clone();
        value[code][key] = invalid;
        expect(() => validateAbouts(value)).toThrow(`Missing about content: ${code}`);
        expect(() => headData(code, 'about', value[code])).toThrow(
          `${code}/about ${key}: ${Array.from(invalid).length} code points (limit ${limit}; nonblank required)`,
        );
      }
    }
  });

  it('registers precisely sixteen PUBLIC and eighteen SITE URLs and rejects noncanonical about URLs', () => {
    expect(PUBLIC_PAGES).toEqual(['hub', 'about', 'top', 'browse', 'extract', 'remove', 'fix-names', 'create']);
    expect(LOCALES.flatMap(({ code }) => PUBLIC_PAGES.map(page => pagePath(code, page)))).toEqual(publicPaths);
    expect(LOCALES.flatMap(({ code }) => SITE_PAGES.map(page => pagePath(code, page))).sort()).toEqual([...sitePaths].sort());
    for (const [index, locale] of ['ja', 'en'].entries()) {
      const path = aboutPaths[index];
      expect(publicPageFromPath(path)).toEqual({ locale, page: 'about' });
      expect(sitePageFromPath(path)).toEqual({ locale, page: 'about' });
      expect(publicPageFromUrl(`${SITE_ORIGIN}${path}`)).toEqual({ locale, page: 'about' });
      expect(zipPageFromPath(path)).toBeUndefined();
    }
    for (const path of ['/about', '/en/about', '/ABOUT/', '/ja/about/', '/fr/about/', '/about//', '/en//about/',
      '/%61bout/', '/about/extra/', '/about/?q=1', '/en/about/#part', '/zip/../about/']) {
      expect(publicPageFromPath(path), path).toBeUndefined();
      expect(sitePageFromPath(path), path).toBeUndefined();
      expect(publicPageFromUrl(`${SITE_ORIGIN}${path}`), path).toBeUndefined();
      expect(zipPageFromPath(path), path).toBeUndefined();
    }
    for (const value of ['https://foreign.invalid/about/', `${SITE_ORIGIN}/about/?x=1`, `${SITE_ORIGIN}/about/#part`]) {
      expect(publicPageFromUrl(value)).toBeUndefined();
    }
  });
});

describe('c370-about built documents', () => {
  for (const { code } of LOCALES) it(`${code} renders meaningful static content, safe metadata and a single PWA owner`, () => {
    withDocument(read(code === 'ja' ? '/about/' : '/en/about/'), document => {
      const content: AboutContent = aboutContent(code);
      const body = document.querySelector('#page-content.page-content')!;
      expect(document.querySelector('#page-heading')?.textContent).toBe(code === 'ja' ? 'runlocally について' : 'About runlocally');
      expect([...body.children].map(node => node.tagName)).toEqual(['P', 'P', 'P', 'H2', 'OL', 'H2', 'UL', 'P']);
      expect(body.querySelector('.page-lead')?.textContent).toMatch(code === 'ja' ? /端末内.*ZIP.*JPG／PNG/ : /ZIP.*JPG or PNG.*device/);
      expect(body.children[1].textContent).toMatch(code === 'ja' ? /無料.*匿名/ : /free.*anonymously/);
      expect(body.children[2].textContent).toMatch(code === 'ja' ? /AI.*レビュー.*判断.*運営者/ : /AI assistance.*maintainer.*review and decisions/);
      const steps = [...body.querySelectorAll('ol > li')].map(node => node.textContent ?? '');
      expect(steps).toHaveLength(4);
      expect(steps[0]).toMatch(code === 'ja' ? /読み込む前.*Network.*初期資産.*precache.*完了/ : /Network before loading.*initial assets.*precache.*complete/);
      expect(steps[1]).toMatch(code === 'ja' ? /入力・操作・保存.*通信先.*リクエスト内容.*混同しない/ : /Input.*operations.*save.*destinations.*request contents.*Distinguish/);
      expect(steps[2]).toContain("connect-src 'self'");
      expect(steps[2]).toMatch(code === 'ja' ? /同一オリジン.*ではなく.*CSP 単独.*証明.*できません/ : /does not prohibit same-origin.*CSP alone cannot prove/);
      expect(steps[3]).toMatch(code === 'ja' ? /保存完了.*SW 制御開始.*Offline.*旧 SW.*新しい SW.*保存・適用.*OS.*保証しません/ : /saving completes.*SW control.*Offline.*old SW.*new SW.*saved and applied.*OS installation/);
      expect([...body.querySelectorAll('ul a')].map(node => node.getAttribute('href'))).toEqual([repository, `${repository}/issues`, '/SECURITY.md']);
      expect(body.lastElementChild?.textContent).toMatch(code === 'ja' ? /Issues.*脆弱性.*非公開/ : /Issues.*vulnerabilities.*private/);
      const canonical = `${SITE_ORIGIN}${code === 'ja' ? '/about/' : '/en/about/'}`;
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonical);
      expect([...document.querySelectorAll('link[rel="alternate"]')].map(node => [node.getAttribute('hreflang'), node.getAttribute('href')])).toEqual([
        ['ja', `${SITE_ORIGIN}/about/`], ['en', `${SITE_ORIGIN}/en/about/`], ['x-default', `${SITE_ORIGIN}/en/about/`],
      ]);
      expect(document.querySelector('meta[name="robots"]')).toBeNull();
      expect(Array.from(document.title).length).toBeLessThanOrEqual(60);
      expect(Array.from(document.querySelector('meta[name="description"]')!.getAttribute('content')!).length).toBeLessThanOrEqual(120);
      const json = document.querySelectorAll('script[type="application/ld+json"]');
      expect(json).toHaveLength(1);
      expect(JSON.parse(json[0].textContent!)).toEqual({ '@context': 'https://schema.org', '@graph': [
        { '@type': 'WebPage', name: content.h1, description: content.description, url: canonical, inLanguage: code },
        { '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: code === 'ja' ? 'ホーム' : 'Home', item: `${SITE_ORIGIN}${code === 'ja' ? '/' : '/en/'}` },
          { '@type': 'ListItem', position: 2, name: content.h1, item: canonical },
        ] },
      ] });
      expect(document.querySelectorAll('astro-island[component-export="PwaStartup"]')).toHaveLength(1);
      expect(document.querySelectorAll('astro-island')).toHaveLength(1);
      expect(document.querySelectorAll('.workbench, [data-chrome-nav], .operation-cards, [component-export="ImageConverter"]')).toHaveLength(0);
    });
  });

  it('keeps same-language ordinary about links and the single footer paragraph on every SITE document', () => {
    for (const path of sitePaths) withDocument(read(path), document => {
      const footer = document.querySelector('.site-footer')!;
      expect(footer.querySelectorAll('p')).toHaveLength(1);
      for (const locale of ['ja', 'en']) {
        const links = footer.querySelectorAll(`[data-trust-locale="${locale}"] [data-trust-link="about"]`);
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute('href')).toBe(locale === 'ja' ? '/about/' : '/en/about/');
        expect(links[0].textContent).toBe(locale === 'ja' ? 'このサイトについて' : 'About this site');
        expect([...footer.querySelectorAll(`[data-trust-locale="${locale}"] a`)].map(a => a.getAttribute('data-trust-link')))
          .toEqual(['about', 'source', 'issues']);
      }
      expect(document.querySelectorAll('[ping], [prefetch], [rel~="prefetch"], [rel~="preconnect"], a[target], iframe')).toHaveLength(0);
    });
  });

  it('outputs sixteen sitemap URLs, eighteen precached documents and nineteen consistently stamped HTML files', () => {
    const locations = (source: string) => {
      const result: string[] = [];
      withDocument(source, document => result.push(...[...document.getElementsByTagName('loc')].map(node => node.textContent!)), true);
      return result;
    };
    const children = locations(readFileSync('dist/sitemap-index.xml', 'utf8'));
    expect(children.length).toBeGreaterThan(0);
    const listed = children.flatMap(url => locations(readFileSync(join('dist', new URL(url).pathname), 'utf8')));
    expect(listed.sort()).toEqual(publicPaths.map(path => `${SITE_ORIGIN}${path}`).sort());
    for (const path of aboutPaths) expect(listed.filter(url => url === `${SITE_ORIGIN}${path}`)).toHaveLength(1);
    const sw = readFileSync('dist/sw.js', 'utf8');
    const cached = [...sw.matchAll(/(?:url:|"url":)"([^"]+)"/g)].map(match => match[1]).filter(path => path.endsWith('/'));
    expect(cached.sort()).toEqual([...sitePaths].sort());
    expect(sw).not.toMatch(/url:(?:"\/?)?404\.html/);
    const htmlFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? htmlFiles(join(dir, entry.name)) : entry.name.endsWith('.html') ? [join(dir, entry.name)] : []);
    const files = htmlFiles('dist');
    expect(files).toHaveLength(19);
    const build = withBuild(read('/'));
    expect(build).toHaveLength(1);
    for (const file of files) expect(withBuild(readFileSync(file, 'utf8')), file).toEqual(build);
  });
});

function withBuild(html: string) {
  const values: (string | null)[] = [];
  withDocument(html, document => values.push(...[...document.querySelectorAll('meta[name="build"]')].map(node => node.getAttribute('content'))));
  return values;
}

it('c370-about rejects missing and duplicate about HTML in small output fixtures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'about-output-'));
  const vendor = ['vendor/libarchive/libarchive.wasm', 'vendor/libarchive/worker-bundle.js', 'vendor/libheif/libheif.wasm'];
  const assets = ['manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png', 'SECURITY.md', '_astro/worker-test.js', ...vendor];
  const entries = [...sitePaths.map(path => ({ url: filePath(path), revision: path })), ...assets.map(url => ({ url, revision: url }))];
  const html = '<html><head></head><body></body></html>';
  try {
    for (const path of [...sitePaths.map(filePath), ...vendor]) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), path.endsWith('.html') ? html : path);
    }
    for (const path of aboutPaths) {
      await expect(transformPrecache(entries.filter(entry => entry.url !== filePath(path)), root)).rejects.toThrow(`Missing public HTML: ${path}`);
      rmSync(join(root, filePath(path)));
      await expect(addBuildMetaToOutput(pathToFileURL(`${root}/`), 'dev')).rejects.toThrow(`Missing public HTML: ${path}`);
      writeFileSync(join(root, filePath(path)), html);
      await expect(transformPrecache([...entries, { url: filePath(path), revision: 'duplicate' }], root)).rejects.toThrow('Unexpected or duplicate HTML');
      // A second HTML representation under about must also be refused before any stamping.
      const extra = join(root, path, 'duplicate.html');
      writeFileSync(extra, html);
      await expect(addBuildMetaToOutput(pathToFileURL(`${root}/`), 'dev')).rejects.toThrow('Unexpected or duplicate HTML');
      rmSync(extra);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
