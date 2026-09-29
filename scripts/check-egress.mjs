import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const exact = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'https://bit.ly/wb-precache',
]);
const scoped = [
  ['https://schema.org', '/'],
  ['https://runlocally.app', '/'],
  // The operator's public Zenn profile is an approved publication link.
  ['https://zenn.dev', '/geppetto'],
];
const repository = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).repository;
const repositoryUrl = new URL(repository);
scoped.push([repositoryUrl.origin, repositoryUrl.pathname.split('/').slice(0, 2).join('/')]);

export function allowedUrl(value) {
  let url;
  try { url = new URL(value); } catch { return 'invalid URL'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'invalid protocol';
  if (url.username || url.password) return 'userinfo';
  if (url.search || url.hash) return 'query or fragment';
  if (exact.has(url.href)) return null;
  if (scoped.some(([origin, prefix]) => url.origin === origin &&
    (prefix === '/' || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)))) return null;
  return 'outside allowlist';
}

const literal = /https?:\/\/[^\s"'`<>\\)]+/g;
export function scanSource(source) {
  const issues = [];
  for (const match of source.matchAll(literal)) {
    const candidate = match[0].replace(/[;,}]+$/, '');
    const reason = allowedUrl(candidate);
    if (reason) issues.push({ line: source.slice(0, match.index).split('\n').length, reason, url: candidate });
  }
  return issues;
}

export async function scanDist(root) {
  const issues = [];
  let count = 0;
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(html|js)$/.test(entry.name)) {
        count++;
        const source = await readFile(file, 'utf8');
        for (const issue of scanSource(source)) issues.push(`${relative(root, file)}:${issue.line}: ${issue.reason}: ${issue.url}`);
      }
    }
  }
  await visit(root);
  if (!count) throw new Error('No HTML or JS files in dist');
  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const issues = await scanDist(process.argv[2] || 'dist');
    if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
    else console.log('Static URL literals are within the allowlist.');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
