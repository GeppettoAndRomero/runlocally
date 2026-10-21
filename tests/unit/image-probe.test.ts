import { expect, it, vi } from 'vitest';
import { createImageCapabilityProbe, imageProbeBytes, NATIVE_IMAGE_FORMATS } from '../../src/engine/image/probe';
import { sniffImageFormat } from '../../src/engine/image/sniff';

it('identifies every complete encoded sample', () => {
  for (const format of NATIVE_IMAGE_FORMATS) expect(sniffImageFormat(imageProbeBytes(format))).toBe(format);
});
it('starts in parallel, caches pending and settled results, and closes each bitmap', async () => {
  const close = vi.fn();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const decode = vi.fn(async (_blob: Blob, options: ImageBitmapOptions) => {
    expect(options).toEqual({ imageOrientation: 'from-image' });
    await pending; return { close };
  });
  const probe = createImageCapabilityProbe(decode);
  const first = probe();
  expect(decode).toHaveBeenCalledTimes(7);
  expect(probe()).toBe(first);
  finish();
  expect(Object.values(await first)).toEqual(Array(7).fill(true));
  expect(close).toHaveBeenCalledTimes(7);
  expect(probe()).toBe(first);
  expect(decode).toHaveBeenCalledTimes(7);
});
it('isolates synchronous and asynchronous failures and test caches', async () => {
  let index = 0;
  const close = vi.fn();
  const probe = createImageCapabilityProbe(() => {
    if (index++ === 0) throw new Error('sync');
    if (index === 2) return Promise.reject(new Error('async'));
    return Promise.resolve({ close });
  });
  expect(Object.values(await probe())).toEqual([false, false, true, true, true, true, true]);
  expect(close).toHaveBeenCalledTimes(5);
  expect(Object.values(await createImageCapabilityProbe(async () => ({ close }))())).toEqual(Array(7).fill(true));
});
it('returns false for every format if the native API is absent', async () => {
  vi.stubGlobal('createImageBitmap', undefined);
  try { expect(Object.values(await createImageCapabilityProbe()())).toEqual(Array(7).fill(false)); }
  finally { vi.unstubAllGlobals(); }
});
