import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { checkDocument } from './check-deployed-build.mjs';

export const KEY = 'b36a6fff0b8102f1103839f0f4854476'; // Public ownership proof, not a secret.
const ORIGIN = 'https://runlocally.app';
export const KEY_LOCATION = `${ORIGIN}/${KEY}.txt`;
const SHA = /^[a-f\d]{40}$/;
const request = (url, options = {}) => fetch(url, {
  ...options, redirect: 'error', signal: AbortSignal.timeout(15_000),
  headers: { 'Cache-Control': 'no-cache', ...options.headers },
});

export async function revision(get = request) {
  const response = await get(`${ORIGIN}/`);
  if (response.status !== 200 || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) throw Error('apex response invalid');
  const html = await response.text();
  const dom = new JSDOM(html);
  try { return checkDocument(html, dom.window.document.querySelector('meta[name="build"]')?.content ?? ''); }
  finally { dom.window.close(); }
}

export function readManifest(sha, run = execFileSync) {
  if (!SHA.test(sha ?? '')) throw Error('invalid manifest SHA');
  const data = JSON.parse(run('git', ['show', `${sha}:src/seo/lastmod.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!data || Array.isArray(data) || typeof data !== 'object' ||
      Object.values(data).some(entry => !/^[a-f\d]{16}$/.test(entry?.hash ?? ''))) throw Error('invalid manifest');
  return data;
}

// Registries contain indexable canonical pages. Also reject known non-public routes
// defensively, including assets, encoded paths, preview origins and image tools.
export const eligible = url => /^https:\/\/runlocally\.app\/(?:[a-z0-9-]+\/)*$/.test(url) &&
  !/^\/(?:en\/)?image(?:\/|$)/.test(url.slice(ORIGIN.length)) &&
  !/^\/(?:assets|icons|_astro)\//.test(url.slice(ORIGIN.length));

export function changedUrls(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(url => eligible(url) && before[url]?.hash !== after[url]?.hash).sort();
}

export async function notify(previous, target, {
  dryRun = false, read = readManifest, get = request, observe = () => revision(get),
  save = async (name, data) => {
    await mkdir('indexnow-state', { recursive: true });
    await writeFile(`indexnow-state/${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
  }, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const manifest = read(target);
  let before;
  try { before = previous ? read(previous) : undefined; }
  catch { console.warn('Previous manifest unavailable; establishing baseline without notification'); }
  const urls = before ? changedUrls(before, manifest) : [];
  if (dryRun) { console.log(JSON.stringify({ target, baseline: !before, urlList: urls })); return; }
  const pending = { target, previous, urlList: urls, status: 'pending', diagnostic: '' };
  await save('pending', pending);
  try {
    if (await observe() !== target) throw Error('production revision changed');
    await save('deployed', { target, previous, manifest, baseline: !before });
    do {
      const batch = pending.urlList.slice(0, 10_000);
      for (let attempt = 0; attempt < 3; attempt++) {
        // A later deployment invalidates this notification, including its retries.
        if (await observe() !== target) throw Error('production revision changed');
        let diagnostic;
        let retryable = false;
        try {
          const key = await get(KEY_LOCATION);
          if (key.status === 429 || key.status >= 500 && key.status < 600) throw Error(`public key HTTP ${key.status}`);
          if (key.status !== 200 || await key.text() !== KEY) throw Object.assign(Error('public key verification failed'), { retryable: false });
          if (!batch.length) break;
          const response = await get('https://api.indexnow.org/indexnow', {
            method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ host: 'runlocally.app', key: KEY, keyLocation: KEY_LOCATION, urlList: batch }),
          });
          diagnostic = ({ 200: 'received', 202: 'key verification pending', 400: 'invalid format',
            403: 'invalid key', 422: 'URL/key mismatch', 429: 'rate limited' })[response.status] ?? 'unexpected response';
          diagnostic = `HTTP ${response.status}: ${diagnostic}`;
          if ([200, 202].includes(response.status)) { pending.diagnostic = diagnostic; break; }
          retryable = response.status === 429 || response.status >= 500 && response.status < 600;
        } catch (error) {
          diagnostic = error.message;
          retryable = error.retryable !== false;
        }
        console.warn(`IndexNow attempt ${attempt + 1}: ${diagnostic}`);
        if (!retryable || attempt === 2) throw Error(diagnostic);
        await sleep(1000 * 2 ** attempt);
      }
      pending.urlList = pending.urlList.slice(batch.length);
      await save('pending', pending);
    } while (pending.urlList.length);
    pending.status = before ? 'complete' : 'baseline';
    await save('pending', pending);
  } catch (error) {
    pending.diagnostic = error.message;
    await save('pending', pending);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const main = async () => {
    if (args[0] === '--capture' && args.length === 1) {
      let previous = '';
      try { previous = await revision(); } catch { console.warn('Previous apex SHA unavailable; baseline required'); }
      console.log(`previous=${previous}`);
      return;
    }
    const [previous, target, flag] = args;
    if (args.length < 2 || args.length > 3 || flag && flag !== '--dry-run') throw Error('usage: indexnow.mjs PREVIOUS_SHA_OR_EMPTY TARGET_SHA [--dry-run]');
    await notify(previous, target, { dryRun: flag === '--dry-run' });
  };
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
