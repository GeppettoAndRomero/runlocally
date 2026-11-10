// BEGIN GENERATED LEGACY TABLES
const LEGACY_SLUGS = [
  "audio-silence-remover",
  "audio-trim",
  "compare-text",
  "compare-xlsx",
  "convert-case",
  "convert-color",
  "convert-timestamp",
  "count-text",
  "create-zip",
  "csv-to-xlsx",
  "csv-viewer",
  "decode-certificate",
  "decode-jwt",
  "draw-flowchart",
  "edit-ascii-diagram",
  "edit-flowchart",
  "edit-markdown-table",
  "eml-viewer",
  "encode-base64",
  "encrypt-zip",
  "extract-rar-7z",
  "file-hash",
  "format-json",
  "format-sql",
  "har-viewer",
  "heic-to-jpg",
  "hex-viewer",
  "identify-file",
  "images-to-xlsx",
  "inspect-characters",
  "markdown-viewer",
  "merge-zip",
  "normalize-text",
  "password-generator",
  "pdf-extract-text",
  "pdf-merge",
  "pdf-split",
  "pdf-to-image",
  "qr-generator",
  "recover-zip",
  "remove-from-zip",
  "rename-images",
  "spell-characters",
  "split-zip",
  "strip-tracking",
  "strip-xlsx-metadata",
  "unlock-xlsx",
  "unlock-zip",
  "unzip",
  "webp-to-jpg",
  "winmail-viewer",
  "xls-to-xlsx",
  "xlsx-extract-images",
  "xlsx-merge",
  "xlsx-to-csv",
  "xlsx-to-json",
  "xlsx-to-markdown",
  "xlsx-viewer",
  "yaml-to-json",
  "zip-filename-fix",
  "zip-viewer"
];
// END GENERATED LEGACY TABLES

const LEGACY_SLUG_SET = new Set(LEGACY_SLUGS);
const GONE_ROOTS = new Set(['blog', 'privacy', 'ja', 'zh', 'de', 'es', 'hub-sitemap.xml']);

function withHostHeader(response, hostname) {
  if (!hostname.endsWith('.pages.dev')) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Old pages whose function now lives on a published page in the same language move there with a 301. Only these document
// paths move (the old root was English, /ja/ Japanese; with and without the trailing slash). /en/<slug>/, the other old
// languages, worker scripts, assets and child paths stay gone. See docs/PWA.md, "Old URLs".
const LEGACY_DOCUMENT_REDIRECTS = new Map(Object.entries({
  'zip-viewer': 'view', unzip: 'extract', 'remove-from-zip': 'remove', 'zip-filename-fix': 'fix-names', 'create-zip': 'create',
}).flatMap(([slug, operation]) => [
  [`/${slug}/`, `/en/zip/${operation}/`], [`/${slug}`, `/en/zip/${operation}/`],
  [`/${slug}/ja/`, `/zip/${operation}/`], [`/${slug}/ja`, `/zip/${operation}/`],
]));

// The sitemap once lived at /sitemap.xml; search engines that still request it reach the current index.
const SITEMAP_REDIRECTS = new Map([['/sitemap.xml', '/sitemap-index.xml']]);

function movedTo(url, pathname) {
  return new Response(null, {
    status: 301,
    headers: { Location: new URL(pathname, url).href, 'Cache-Control': 'public, max-age=3600' },
  });
}

function gone() {
  return new Response(null, {
    status: 410,
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const slug = parts[0];
  let response;

  const documentTarget = ['GET', 'HEAD'].includes(context.request.method) ? LEGACY_DOCUMENT_REDIRECTS.get(url.pathname) : undefined;

  if (documentTarget) {
    response = movedTo(url, documentTarget);
  } else if (LEGACY_SLUG_SET.has(slug) || (slug === 'en' && LEGACY_SLUG_SET.has(parts[1]))) {
    response = gone();
  } else if (GONE_ROOTS.has(slug)) {
    response = gone();
  } else if (SITEMAP_REDIRECTS.has(url.pathname)) {
    response = movedTo(url, SITEMAP_REDIRECTS.get(url.pathname));
  } else {
    response = await context.next();
  }

  return withHostHeader(response, url.hostname);
}
