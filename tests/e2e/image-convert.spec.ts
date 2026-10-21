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
  directory = await mkdtemp(join(tmpdir(), 'image-browser-'));
  const entry = resolve('src/engine/image/__test-harness.ts');
  try {
    await build({ configFile: false, publicDir: false, logLevel: 'error',
      plugins: [{ name: 'image-test-harness', resolveId: id => id === entry ? entry : undefined,
        load: id => id === entry ? `
          import { wrap, releaseProxy } from 'comlink';
          import { convertImage, decodeNativeImage, mainThreadImageCanvas } from './convert';
          export async function convert(input, format, route) {
            if (route === 'main') return convertImage(input, format, {
              decode: decodeNativeImage, canvas: mainThreadImageCanvas(() => document.createElement('canvas'))
            });
            const worker = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' });
            const api = wrap(worker);
            try { return (await api.convert({ type: 'convert', requestId: 1, input, format })).result; }
            finally { api[releaseProxy](); worker.terminate(); }
          }
        ` : undefined }],
      build: { outDir: directory, emptyOutDir: true, minify: false,
        rollupOptions: { input: entry, preserveEntrySignatures: 'strict', output: { entryFileNames: 'harness.js' } } } });
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Image conversion test</title>');
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

for (const route of ['worker', 'main'] as const) {
  test(`real image decoding, pixels and output through ${route}`, async ({ page }, testInfo) => {
    await page.goto(origin);
    const run = async (name: string, format: 'jpg' | 'png' = 'png') => {
      const bytes = Array.from(await readFile(join('tests/fixtures/image', name)));
      return page.evaluate(async ({ bytes, format, route }) => {
        const modulePath = '/harness.js';
        const harness = await import(modulePath);
        const input = new Blob([new Uint8Array(bytes)], { type: 'text/plain' });
        let nativeSupported = false;
        try {
          const probe = await createImageBitmap(input, { imageOrientation: 'from-image' });
          probe.close(); nativeSupported = true;
        } catch { /* Capability is recorded independently from conversion. */ }
        const result = await harness.convert(input, format, route);
        if (!result.ok) return { code: result.code, nativeSupported };
        const bitmap = await createImageBitmap(result.value);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Missing output context');
          context.drawImage(bitmap, 0, 0);
          const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
          const pixels = { left: pixel(0, 0), middle: pixel(12, 12), right: pixel(31 < bitmap.width ? 31 : 23, 0),
            bottom: pixel(0, bitmap.height - 1) };
          const signature = Array.from(new Uint8Array(await result.value.slice(0, 8).arrayBuffer()));
          return { code: null, nativeSupported, width: bitmap.width, height: bitmap.height,
            mime: result.value.type, size: result.value.size, pixels, signature };
        } finally { bitmap.close(); }
      }, { bytes, format, route });
    };
    for (const name of ['alpha.png', 'oriented.jpg', 'alpha.webp', 'animated.gif', 'sample.bmp', 'sample.ico']) {
      const output = await run(name);
      expect(output.code, name).toBeNull();
      expect(output.mime).toBe('image/png');
      expect(output.size).toBeGreaterThan(0);
      expect(output.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(output.width).toBe(name === 'oriented.jpg' ? 24 : 32);
      expect(output.height).toBe(name === 'oriented.jpg' || name === 'sample.ico' ? 32 : 24);
      if (name === 'alpha.png' || name === 'alpha.webp') {
        expect(output.pixels?.left[3]).toBe(0);
        expect(output.pixels?.middle[3]).toBe(128);
        expect(output.pixels?.right[3]).toBe(255);
      }
      if (name === 'animated.gif') expect(output.pixels?.middle).toEqual([255, 0, 0, 255]);
      if (name === 'oriented.jpg') {
        // Rotation maps the transparent/white left band to the top and red right band to the bottom.
        for (const channel of output.pixels!.left.slice(0, 3)) expect(channel).toBeGreaterThan(240);
        expect(output.pixels!.bottom[0]).toBeGreaterThan(220);
        expect(output.pixels!.bottom[1]).toBeGreaterThan(220);
        expect(output.pixels!.bottom[2]).toBeLessThan(35);
      }
    }
    const white = await run('alpha.png', 'jpg');
    expect(white.code).toBeNull();
    expect(white.mime).toBe('image/jpeg');
    expect(white.signature?.slice(0, 3)).toEqual([255, 216, 255]);
    for (const channel of white.pixels!.left) expect(channel).toBeGreaterThan(245);
    for (const name of ['sample.avif', 'sample.heic']) {
      const output = await run(name);
      testInfo.annotations.push({ type: 'native-decode', description: `${name}: ${output.nativeSupported}` });
      expect(output.code).toBe(output.nativeSupported ? null : name.endsWith('avif')
        ? 'decode-failed' : 'heic-decoder-unavailable');
      if (output.nativeSupported) expect(output.size).toBeGreaterThan(0);
    }
  });
}
