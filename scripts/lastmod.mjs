import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(root, 'src/seo/lastmod.json');
const whitespace = value => value.replace(/\s+/g, ' ').trim();
// Vite's fingerprint is packaging, while the asset's logical name is meaningful.
const assetName = value => value.replace(/(\/_astro\/[^/?#]+)[._-][\w-]{8}(\.[a-z\d]+)(?=[?#]|$)/gi, '$1$2');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  : typeof value === 'string' ? assetName(value) : value;

export function contentHash(html) {
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    if (!document.querySelector('main h1') || !document.title) throw new Error('Missing page content');
    const head = [...document.head.querySelectorAll('title, meta, link')].flatMap(node => {
      const tag = node.localName;
      if (tag === 'title') return [['title', whitespace(node.textContent)]];
      if (tag === 'meta') {
        const key = node.getAttribute('name') || node.getAttribute('property') || '';
        return /^(description|robots|og:.*|twitter:.*)$/.test(key)
          ? [['meta', key, assetName(node.getAttribute('content') || '')]] : [];
      }
      return ['canonical', 'alternate'].includes(node.getAttribute('rel'))
        ? [['link', node.getAttribute('rel'), node.getAttribute('hreflang'), assetName(node.getAttribute('href') || '')]] : [];
    });
    // Structured data counts wherever it is placed (head or body).
    const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(node => stable(JSON.parse(node.textContent)));
    function body(node) {
      if (node.nodeType === 3) return whitespace(node.textContent) || null;
      if (node.nodeType !== 1 || ['script', 'style', 'template'].includes(node.localName)) return null;
      const attributes = ['href', 'src', 'alt', 'title', 'aria-label', 'lang'].filter(name => node.hasAttribute(name))
        .map(name => [name, assetName(node.getAttribute(name))]);
      const children = [...node.childNodes].map(body).filter(value => value !== null);
      // Ignore layout, CSS scopes and island props (which contain unused dictionary entries).
      const tag = /^(h[1-6]|a|img|p|li|dt|dd|th|td|button|label)$/.test(node.localName) ? node.localName : '';
      return tag || attributes.length ? [tag, attributes, children] : children.flat();
    }
    return createHash('sha256').update(JSON.stringify([document.documentElement.lang, head, jsonld, body(document.body)])).digest('hex')
      // 64 bits are enough to detect a change; a shorter value is also less likely to match the
      // repository's personal leak patterns by chance (the pre-commit leak check scans this file).
      .slice(0, 16);
  } finally { dom.window.close(); }
}

export function validateRegistry(registry) {
  if (!registry || Array.isArray(registry) || typeof registry !== 'object') throw new Error('Invalid lastmod registry');
  for (const [url, entry] of Object.entries(registry)) {
    if (!/^https:\/\/[^/?#]+\/(?:[^?#]*\/)?$/.test(url) || !entry || !/^[a-f\d]{16}$/.test(entry.hash) ||
      !(entry.lastmod === null || (typeof entry.lastmod === 'string' && /^\d{4}-\d\d-\d\d$/.test(entry.lastmod) &&
        Number.isFinite(Date.parse(entry.lastmod)) && new Date(entry.lastmod).toISOString().slice(0, 10) === entry.lastmod))) {
      throw new Error(`Invalid lastmod entry: ${url}`);
    }
  }
  return registry;
}

export function sitemapLastmod(registry, url) {
  return registry[url]?.lastmod ?? undefined;
}

export function updateRegistry(previous, hashes, now = new Date(), initialize = false) {
  validateRegistry(previous);
  if (initialize && Object.keys(previous).length) throw new Error('lastmod is already initialized');
  const today = now.toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(hashes).sort().map(([url, hash]) => {
    const old = previous[url];
    return [url, { hash, lastmod: old?.hash === hash ? old.lastmod : old || initialize ? today : null }];
  }));
}

export async function builtHashes(output = join(root, 'dist')) {
  function locations(xml) {
    const dom = new JSDOM(xml, { contentType: 'application/xml' });
    try { return [...dom.window.document.querySelectorAll('loc')].map(node => node.textContent); }
    finally { dom.window.close(); }
  }
  // Sitemap membership comes from Astro's PUBLIC URL model, including any new routes.
  const children = locations(await readFile(join(output, 'sitemap-index.xml'), 'utf8'));
  const urls = (await Promise.all(children.map(async url => {
    const name = new URL(url).pathname.slice(1);
    if (!/^sitemap-\d+\.xml$/.test(name)) throw new Error('Unexpected sitemap child');
    return locations(await readFile(join(output, name), 'utf8'));
  }))).flat();
  if (!urls.length || new Set(urls).size !== urls.length) throw new Error('Missing or duplicate sitemap URLs');
  return Object.fromEntries(await Promise.all(urls.map(async url => [url,
    contentHash(await readFile(join(output, new URL(url).pathname.slice(1), 'index.html'), 'utf8')),
  ])));
}

export function checkRegistry(registry, hashes) {
  validateRegistry(registry);
  const stale = [...new Set([...Object.keys(hashes), ...Object.keys(registry)])]
    .filter(url => !hashes[url] || registry[url]?.hash !== hashes[url]);
  if (!Object.keys(hashes).length) throw new Error('Missing built hashes');
  if (stale.length) throw new Error(`lastmod hashes differ: ${stale.join(', ')}; run npm run lastmod:update, then rebuild`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length || !['--check', '--update', '--initialize'].includes(mode)) throw new Error('Usage: lastmod.mjs --check|--update|--initialize');
    const registry = validateRegistry(JSON.parse(await readFile(registryPath, 'utf8')));
    const hashes = await builtHashes();
    if (mode === '--check') checkRegistry(registry, hashes);
    else await writeFile(registryPath, `${JSON.stringify(updateRegistry(registry, hashes, new Date(), mode === '--initialize'), null, 2)}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
