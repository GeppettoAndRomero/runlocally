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
  directory = await mkdtemp(join(tmpdir(), 'image-heic-'));
  const entry = resolve('src/engine/image/__heic-harness.ts');
  const wasm = await readFile('node_modules/libheif-js/libheif-wasm/libheif.wasm');
  try {
    await build({ configFile: false, publicDir: false, logLevel: 'error',
      plugins: [{ name: 'heic-test-harness', resolveId: id => id === entry ? entry : undefined,
        load: id => id === entry ? `
          import { convertImage, createOffscreenImageCanvas } from './convert';
          import { HeicWorkerManager } from './heic-client';
          // Native decoding is forced to fail so the libheif worker is the only decoder.
          export async function rescue(input, format, terminateAfter) {
            const manager = new HeicWorkerManager();
            try {
              return await convertImage(input, format, {
                decode: async () => { throw new Error('native'); },
                canvas: createOffscreenImageCanvas, rescueDecode: manager.rescueDecode,
              });
            } finally { if (terminateAfter) manager.terminate(); }
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

test('decodes a HEIC image through the libheif worker when native decoding fails', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(origin);
  const bytes = Array.from(await readFile('tests/fixtures/image/sample.heic'));
  const output = await page.evaluate(async ({ bytes }) => {
    const modulePath = '/harness.js';
    const harness = await import(modulePath);
    const input = new Blob([new Uint8Array(bytes)]);
    const results = [];
    for (const format of ['png', 'jpg']) {
      const result = await harness.rescue(input, format, false);
      if (!result.ok) { results.push({ format, code: result.code }); continue; }
      const bitmap = await createImageBitmap(result.value);
      results.push({ format, code: null, mime: result.value.type, width: bitmap.width, height: bitmap.height });
      bitmap.close();
    }
    return results;
  }, { bytes });
  expect(output).toEqual([
    { format: 'png', code: null, mime: 'image/png', width: 240, height: 240 },
    { format: 'jpg', code: null, mime: 'image/jpeg', width: 240, height: 240 },
  ]);
  expect(requests.filter(path => path.endsWith('.wasm'))).toEqual(['/vendor/libheif/libheif.wasm', '/vendor/libheif/libheif.wasm']);
});
