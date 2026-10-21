import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'image-client-'));
  const entry = resolve('src/app/image/__client-harness.ts');
  const wasm = await readFile('node_modules/libheif-js/libheif-wasm/libheif.wasm');
  try {
    await build({ configFile: false, publicDir: false, logLevel: 'error',
      plugins: [{ name: 'heic-test-harness', resolveId: id => id === entry ? entry : undefined,
        load: id => id === entry ? `
          import { createImageClient } from './client';
          export async function run(inputs, format) {
            const client = createImageClient();
            const results = [];
            try {
              for (const input of inputs) {
                const result = await client.convert(input, format);
                results.push(result.ok ? { ok: true, blob: result.value } : { ok: false, code: result.code });
              }
              return results;
            } finally { client.terminate(); }
          }
        ` : undefined }],
      build: { outDir: directory, emptyOutDir: true, minify: false,
        rollupOptions: { input: entry, preserveEntrySignatures: 'strict', output: { entryFileNames: 'harness.js' } } } });
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Image HEIC test</title>');
        return;
      }
      if (path === '/vendor/libheif/libheif.wasm') {
        response.setHeader('Content-Type', 'application/wasm');
        response.end(wasm);
        return;
      }
      if (!/^\/(harness\.js|assets\/[\w.-]+\.js)$/.test(path)) {
        response.writeHead(404).end(); return;
      }
      try {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(await readFile(join(directory, path)));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', done);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    origin = `http://127.0.0.1:${address.port}`;
  } catch (error) {
    server?.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
});
test.afterAll(async () => {
  if (server?.listening) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('converts a HEIC image and a PNG through the client with its owned rescue worker', async ({ page, browserName }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(origin);
  const heic = Array.from(await readFile('tests/fixtures/image/sample.heic'));
  const png = Array.from(await readFile('tests/fixtures/image/alpha.png'));
  const output = await page.evaluate(async ({ heic, png }) => {
    const modulePath = '/harness.js';
    const harness = await import(modulePath);
    const inputs = [heic, png, heic].map(bytes => new Blob([new Uint8Array(bytes)]));
    const results = await harness.run(inputs, 'png');
    const summary = [];
    for (const result of results) {
      if (!result.ok) { summary.push({ code: result.code }); continue; }
      const bitmap = await createImageBitmap(result.blob);
      summary.push({ code: null, mime: result.blob.type, width: bitmap.width, height: bitmap.height });
      bitmap.close();
    }
    return summary;
  }, { heic, png });
  expect(output).toEqual([
    { code: null, mime: 'image/png', width: 240, height: 240 },
    { code: null, mime: 'image/png', width: 32, height: 24 },
    { code: null, mime: 'image/png', width: 240, height: 240 },
  ]);
  // Native HEIC decoding may succeed (Safari), in which case no WASM is fetched.
  const wasm = requests.filter(path => path.endsWith('.wasm'));
  expect(wasm.every(path => path === '/vendor/libheif/libheif.wasm')).toBe(true);
  // Chromium and Firefox cannot decode HEIC natively: each HEIC conversion starts a fresh rescue worker.
  if (browserName !== 'webkit') expect(wasm).toHaveLength(2);
});
