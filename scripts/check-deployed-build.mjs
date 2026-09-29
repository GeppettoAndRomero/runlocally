import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const SHA = /^[a-f\d]{40}$/i;
const URL = 'https://runlocally.app/';

export function checkDocument(html, expected) {
  if (!SHA.test(expected)) throw new Error('invalid expected SHA');
  const document = new JSDOM(html).window.document;
  const metas = [...document.querySelectorAll('meta')].filter(meta => meta.getAttribute('name') === 'build');
  if (metas.length !== 1) throw new Error(`build meta count: ${metas.length}`);
  if (!document.head.contains(metas[0])) throw new Error('build meta outside head');
  const observed = metas[0].getAttribute('content') ?? '';
  if (!SHA.test(observed)) throw new Error('invalid observed SHA');
  if (observed !== expected) {
    const error = new Error(`SHA mismatch: expected ${expected}, observed ${observed}`);
    error.retryable = true;
    throw error;
  }
  return observed;
}

export function curlRequest(url, run = execFileSync) {
  const raw = run('curl', ['--silent', '--show-error', '--max-time', '10', '--dump-header', '-', '--header', 'Cache-Control: no-cache', url], {
    encoding: 'utf8', timeout: 11_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let response = raw;
  let header = '';
  do {
    const end = response.search(/\r?\n\r?\n/);
    if (end < 0) throw new Error('invalid HTTP response');
    header = response.slice(0, end);
    response = response.slice(end).replace(/^\r?\n\r?\n/, '');
  } while (/^HTTP\/\S+ 1\d\d\b/.test(header));
  const status = Number(header.match(/^HTTP\/\S+ (\d{3})\b/)?.[1]);
  const contentType = header.match(/^content-type:\s*(.+)$/im)?.[1]?.trim() ?? '';
  return { status, contentType, body: response };
}

export async function verifyUrl(expected, { request = async url => curlRequest(url), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, attempts = 10 } = {}) {
  if (!SHA.test(expected)) throw new Error('invalid expected SHA');
  const start = now();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { status, contentType, body } = await request(URL);
      if (status >= 300 && status < 400) throw new Error(`redirect rejected: HTTP ${status}`);
      if (status >= 500 && status < 600) {
        const error = new Error(`HTTP ${status}`);
        error.retryable = true;
        throw error;
      }
      if (status !== 200) throw new Error(`HTTP ${status}`);
      if (!/^text\/html(?:\s*;|\s*$)/i.test(contentType)) throw new Error('non-HTML response');
      checkDocument(body, expected);
      console.log(`build verified: expected ${expected}, attempt ${attempt}`);
      return;
    } catch (error) {
      if (!error.retryable && error.code !== 'ETIMEDOUT' && error.code !== 'ECONNRESET' && error.code !== 'ENOTFOUND' && error.code !== 'EAI_AGAIN' && ![6, 7, 28, 52, 56].includes(error.status)) throw error;
      const reason = error.retryable ? error.message : 'connection failure';
      if (attempt === attempts || now() - start + 20_000 > 300_000) throw new Error(`build verification exhausted after ${attempt} attempts: ${reason}`);
      console.log(`build verification retry: attempt ${attempt}, ${reason}`);
      await sleep(20_000);
    }
  }
}

async function main(args) {
  const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const sha = value('--sha');
  const file = value('--file');
  const url = value('--url');
  if (!sha || Boolean(file) === Boolean(url) || args.length !== 4) throw new Error('usage: --sha FULL_SHA (--file FILE | --url https://runlocally.app/)');
  if (url) {
    if (url !== URL) throw new Error('unexpected URL');
    await verifyUrl(sha);
  } else {
    checkDocument(await readFile(file, 'utf8'), sha);
    console.log(`build verified: expected ${sha}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
