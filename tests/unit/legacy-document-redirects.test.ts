import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { onRequest } from '../../functions/_middleware.js';

// The expected table is written out by hand so that it does not share logic with the middleware: the old root was
// English, /ja/ was Japanese, and a successor must be a published page of the same language.
const moved: [string, string][] = [
  ['/zip-viewer/', '/en/zip/view/'], ['/zip-viewer', '/en/zip/view/'], ['/zip-viewer/ja/', '/zip/view/'], ['/zip-viewer/ja', '/zip/view/'],
  ['/unzip/', '/en/zip/extract/'], ['/unzip', '/en/zip/extract/'], ['/unzip/ja/', '/zip/extract/'], ['/unzip/ja', '/zip/extract/'],
  ['/remove-from-zip/', '/en/zip/remove/'], ['/remove-from-zip', '/en/zip/remove/'],
  ['/remove-from-zip/ja/', '/zip/remove/'], ['/remove-from-zip/ja', '/zip/remove/'],
  ['/zip-filename-fix/', '/en/zip/fix-names/'], ['/zip-filename-fix', '/en/zip/fix-names/'],
  ['/zip-filename-fix/ja/', '/zip/fix-names/'], ['/zip-filename-fix/ja', '/zip/fix-names/'],
  ['/create-zip/', '/en/zip/create/'], ['/create-zip', '/en/zip/create/'], ['/create-zip/ja/', '/zip/create/'], ['/create-zip/ja', '/zip/create/'],
];
// Old pages that have no successor yet, other old languages, the English-prefixed form, workers, assets and child paths.
const gone = [
  '/recover-zip/', '/recover-zip/ja/', '/split-zip/', '/merge-zip/', '/unlock-zip/', '/encrypt-zip/', '/extract-rar-7z/',
  '/zip-viewer/zh/', '/zip-viewer/de/', '/zip-viewer/es/', '/en/zip-viewer/', '/en/unzip', '/en/create-zip/ja/',
  '/zip-viewer/sw.js', '/unzip/sw.js', '/zip-viewer/ja/sw.js', '/zip-viewer/asset.js', '/unzip/ja/extra/', '/create-zip/ja/x',
];

async function visit(path: string, method = 'GET', host = 'runlocally.app') {
  let calls = 0;
  const response = await onRequest({
    request: new Request(`https://${host}${path}`, { method }),
    next: async () => { calls++; return new Response('upstream', { status: 202 }); },
  });
  return { response, calls };
}

describe('old document pages with a successor', () => {
  it('has exactly the 20 document paths of the five moved functions', () => {
    expect(moved).toHaveLength(20);
    expect(new Set(moved.map(([from]) => from)).size).toBe(20);
  });

  it.each(moved)('moves %s to %s for GET and HEAD, without the query', async (from, to) => {
    for (const method of ['GET', 'HEAD']) {
      for (const query of ['', '?from=old&x=1']) {
        const { response, calls } = await visit(from + query, method);
        expect([response.status, response.headers.get('Location'), calls]).toEqual([301, `https://runlocally.app${to}`, 0]);
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
        expect(await response.text()).toBe('');
      }
    }
  });

  it('points only at pages that are published and in the same language as the old URL', () => {
    for (const [from, to] of moved) {
      expect(to.startsWith('/en/zip/'), from).toBe(!from.includes('/ja'));
      expect(to).toMatch(/^(\/en)?\/zip\/(view|extract|remove|fix-names|create)\/$/);
    }
  });

  it.each(gone)('keeps %s gone', async path => {
    for (const method of ['GET', 'HEAD']) {
      const { response, calls } = await visit(path, method);
      expect([response.status, response.headers.has('Location'), calls]).toEqual([410, false, 0]);
    }
  });

  it('never moves a worker script, and only GET and HEAD move', async () => {
    for (const path of ['/zip-viewer/sw.js', '/unzip/sw.js', '/en/zip-viewer/sw.js']) {
      const { response } = await visit(path);
      expect([response.status, response.headers.has('Location')]).toEqual([410, false]);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const { response } = await visit('/zip-viewer/', method);
      expect([response.status, response.headers.has('Location')]).toEqual([410, false]);
    }
  });

  it('keeps the preview noindex header on a moved page', async () => {
    const { response } = await visit('/unzip/ja/', 'GET', 'project.pages.dev');
    expect([response.status, response.headers.get('Location'), response.headers.get('X-Robots-Tag')])
      .toEqual([301, 'https://project.pages.dev/zip/extract/', 'noindex']);
  });

  it('keeps the table outside the generated legacy region, so the generator cannot remove it', () => {
    const text = readFileSync(new URL('../../functions/_middleware.js', import.meta.url), 'utf8');
    expect(text.indexOf('LEGACY_DOCUMENT_REDIRECTS')).toBeGreaterThan(text.indexOf('// END GENERATED LEGACY TABLES'));
  });
});
