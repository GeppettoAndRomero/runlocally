import { describe, expect, it } from 'vitest';
import slugs from '../../legacy/slugs.json';
import { OPS } from '../../src/i18n/ops';
import { onRequest } from '../../functions/_middleware.js';

async function visit(path: string, host = 'runlocally.app', method = 'GET', upstream?: Response) {
  let calls = 0;
  const response = await onRequest({
    request: new Request(`https://${host}${path}`, { method }),
    next: async () => {
      calls++;
      return upstream ?? new Response('upstream', { status: 200 });
    },
  });
  return { response, calls };
}

describe('legacy routes', () => {
  it('uses the complete historical list and the operation registry', () => {
    expect(slugs).toHaveLength(61);
    expect(new Set(slugs).size).toBe(61);
    expect(OPS.filter(op => op.available)).toHaveLength(4);
    expect(OPS.filter(op => !op.available)).toHaveLength(7);
    expect(slugs.filter(slug => !OPS.some(op => op.slug === slug))).toHaveLength(50);
  });

  it.each(OPS.filter(op => op.available))('redirects old $slug Japanese paths directly to the new Japanese page', async op => {
    for (const method of ['GET', 'HEAD']) {
      const ja = await visit(`/${op.slug}/ja/?keep=0`, 'runlocally.app', method);
      expect([ja.response.status, ja.response.headers.get('Location'), ja.calls]).toEqual([301, `/${op.slug}/`, 0]);
      expect(await ja.response.text()).toBe('');
      const destination = await visit(ja.response.headers.get('Location')!, 'runlocally.app', method);
      expect([destination.response.status, destination.response.headers.get('Location'), destination.calls]).toEqual([200, null, 1]);
    }
    for (const locale of ['zh', 'de', 'es']) {
      const { response, calls } = await visit(`/${op.slug}/${locale}/`);
      expect([response.status, response.headers.get('Location'), calls]).toEqual([410, null, 0]);
    }
    const directJapanese = await visit(`/${op.slug}/`);
    expect([directJapanese.response.status, directJapanese.response.headers.get('Location'), directJapanese.calls]).toEqual([200, null, 1]);
    const newEnglish = await visit(`/en/${op.slug}/`);
    expect([newEnglish.response.status, newEnglish.response.headers.get('Location'), newEnglish.calls]).toEqual([200, null, 1]);
  });

  it.each(OPS.filter(op => !op.available))('keeps unavailable $slug gone', async op => {
    for (const path of [`/${op.slug}/`, `/${op.slug}/ja/`, `/${op.slug}/asset.js`]) {
      const { response, calls } = await visit(path);
      expect([response.status, response.headers.get('Location'), calls]).toEqual([410, null, 0]);
    }
  });

  it.each(slugs.filter(slug => !OPS.some(op => op.slug === slug)))('keeps other historical slug %s gone', async slug => {
    const { response, calls } = await visit(`/${slug}/`);
    expect([response.status, response.headers.get('Location'), calls]).toEqual([410, null, 0]);
  });

  it.each(slugs)('never redirects the old %s service worker', async slug => {
    for (const path of [`/${slug}/sw.js`, `/${slug}/sw.js?version=1`]) {
      const { response, calls } = await visit(path);
      expect([response.status, response.headers.get('Location'), calls]).toEqual([410, null, 0]);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
      expect(await response.text()).toBe('');
    }
  });

  it('matches segment boundaries and old roots', async () => {
    for (const [path, status, location] of [
      ['/zip-viewer', 200, null],
      ['/zip-viewer/ja', 301, '/zip-viewer/'],
      ['/zip-viewer/other.js', 410, null],
      ['/recover-zip', 410, null],
      ['/format-json', 410, null],
    ] as const) {
      const { response, calls } = await visit(path);
      expect([response.status, response.headers.get('Location'), calls]).toEqual([status, location, status === 200 ? 1 : 0]);
    }
    for (const path of ['/blog/', '/blog/post/', '/privacy', '/ja/', '/zh/page/', '/de/', '/es/', '/hub-sitemap.xml']) {
      const { response, calls } = await visit(path);
      expect([response.status, calls]).toEqual([410, 0]);
    }
    for (const path of ['/', '/en/', '/en/zip-viewer/', '/zip-viewer-other/', '/_astro/a.js', '/vendor/a.js', '/sw.js', '/manifest.webmanifest', '/robots.txt', '/sitemap-index.xml', '/SECURITY.md']) {
      const { response, calls } = await visit(path);
      expect([response.status, calls]).toEqual([200, 1]);
    }
  });

  it('adds noindex only on genuine Pages hosts and preserves upstream responses', async () => {
    for (const host of ['project.pages.dev', 'preview.project.pages.dev']) {
      const gone = await visit('/format-json/', host);
      const moved = await visit('/zip-viewer/ja/', host);
      expect(gone.response.headers.get('X-Robots-Tag')).toBe('noindex');
      expect(moved.response.headers.get('X-Robots-Tag')).toBe('noindex');
      for (const status of [200, 404]) {
        const upstream = new Response('body', { status, statusText: 'Custom', headers: {
          'Content-Security-Policy': "default-src 'self'", 'Cache-Control': 'private, max-age=7',
        } });
        const { response, calls } = await visit('/en/zip-viewer/', host, 'GET', upstream);
        expect([response.status, response.statusText, calls, await response.text()]).toEqual([status, 'Custom', 1, 'body']);
        expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=7');
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
      }
    }
    for (const host of ['runlocally.app', 'pages.dev.example.com']) {
      expect((await visit('/zip-viewer/', host)).response.headers.has('X-Robots-Tag')).toBe(false);
    }
    const upstream = new Response('body', { headers: { 'X-Robots-Tag': 'nofollow' } });
    expect((await visit('/', 'runlocally.app', 'GET', upstream)).response.headers.get('X-Robots-Tag')).toBe('nofollow');
  });
});
