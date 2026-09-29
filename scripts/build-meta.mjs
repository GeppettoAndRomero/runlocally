import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicPagePaths } from './pwa-manifest.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shaPattern = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;

function validSha(value, source) {
  if (!shaPattern.test(value)) throw new Error(`Invalid commit SHA from ${source}`);
  return value;
}

export function resolveBuildSha({ env = process.env, root = projectRoot, git = execFileSync } = {}) {
  const supplied = env.GITHUB_SHA?.trim();
  if (supplied) return validSha(supplied, 'GITHUB_SHA');
  try {
    const value = git('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return validSha(value, 'git');
  } catch (error) {
    if (error.message === 'Invalid commit SHA from git') throw error;
    if (env.CI && env.CI !== 'false') throw new Error('Commit SHA is required in CI', { cause: error });
    return 'dev';
  }
}

const metaPattern = /<meta\b[^>]*>/gi;
const namePattern = /\sname\s*=\s*(?:"build"|'build'|build(?=[\s/>]))/i;
const contentPattern = /\bcontent\s*=\s*(["'])(.*?)\1/i;

export function insertBuildMeta(html, sha) {
  if (sha !== 'dev') validSha(sha, 'build');
  const heads = [...html.matchAll(/<head\b[^>]*>/gi)];
  const closes = [...html.matchAll(/<\/head\s*>/gi)];
  if (heads.length !== 1 || closes.length !== 1 || closes[0].index < heads[0].index + heads[0][0].length) {
    throw new Error('Expected one HTML head');
  }
  const start = heads[0].index + heads[0][0].length;
  const end = closes[0].index;
  const metas = [...html.matchAll(metaPattern)].filter(match => namePattern.test(match[0]));
  if (metas.length > 1) throw new Error('Duplicate build meta');
  const tag = `<meta name="build" content="${sha}">`;
  if (metas.length) {
    const match = metas[0];
    if (match.index < start || match.index + match[0].length > end) throw new Error('Build meta is outside head');
    const value = match[0].match(contentPattern)?.[2];
    if (!value || (value !== 'dev' && !shaPattern.test(value))) throw new Error('Invalid existing build meta');
    return html.slice(0, match.index) + tag + html.slice(match.index + match[0].length);
  }
  return html.slice(0, start) + tag + html.slice(start);
}

async function htmlFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
  }
  return files.sort();
}

export async function addBuildMetaToOutput(dir, sha) {
  const output = fileURLToPath(dir);
  const files = await htmlFiles(output);
  if (!files.length) throw new Error('No built HTML found');
  const expected = publicPagePaths();
  const seen = new Set();
  const updates = [];
  for (const file of files) {
    const path = relative(output, file).split(sep).join('/');
    const url = path === 'index.html' ? '/' : `/${path.replace(/index\.html$/, '')}`;
    if (!path.endsWith('index.html') || !expected.has(url) || seen.has(url)) throw new Error(`Unexpected or duplicate HTML: ${path}`);
    seen.add(url);
    updates.push([file, insertBuildMeta(await readFile(file, 'utf8'), sha)]);
  }
  if (seen.size !== expected.size) throw new Error(`Missing public HTML: ${[...expected].filter(url => !seen.has(url)).join(', ')}`);
  for (const [file, html] of updates) await writeFile(file, html);
}

export function buildMetaIntegration({ env = process.env, root = projectRoot, git = execFileSync } = {}) {
  let sha;
  return {
    name: 'build-meta',
    hooks: {
      'astro:build:start': () => { sha = resolveBuildSha({ env, root, git }); },
      'astro:build:done': async ({ dir }) => {
        if (!sha) throw new Error('Build SHA was not resolved');
        await addBuildMetaToOutput(dir, sha);
      },
    },
  };
}
