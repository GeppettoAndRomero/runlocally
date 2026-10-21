import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { CapabilityList } from '../../src/app/image/CapabilityList';
import { ImageConverter } from '../../src/app/image/ImageConverter';
import { DEFAULT_LOCALE, ENGLISH_LOCALE } from '../../src/i18n/locales';
import { imageCapabilityContent } from '../../src/i18n/image-capability';
import type { ImageCapabilities } from '../../src/engine/image/probe';

vi.mock('../../src/ui/PwaStartup', () => ({ PwaStartup: () => null }));
vi.mock('../../src/app/registerSW', () => ({ isUpdateApplying: () => false, subscribeUpdate: () => () => {} }));
const result: ImageCapabilities = { png: true, jpeg: true, gif: false, webp: true, bmp: true, ico: false, avif: false };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
for (const locale of [DEFAULT_LOCALE, ENGLISH_LOCALE]) {
  it(`renders neutral then textual results with fixed fallback in ${locale}`, async () => {
    let finish!: (value: ImageCapabilities) => void;
    const probe = () => new Promise<ImageCapabilities>(resolve => { finish = resolve; });
    const view = render(<CapabilityList locale={locale} probe={probe} />);
    const t = imageCapabilityContent(locale);
    expect(view.container.querySelectorAll('[data-state=checking]')).toHaveLength(7);
    expect(view.container.textContent).toContain(t.note);
    expect(view.container.textContent).toContain(t.fallback);
    expect(view.container.querySelector('li')).toBeNull();
    await act(async () => { finish(result); });
    expect(view.container.querySelectorAll('[data-state=readable]')).toHaveLength(4);
    expect(view.container.querySelectorAll('s')).toHaveLength(3);
    expect(view.container.querySelector('[data-format=png] .capability-value')?.textContent).toBe(`✓ ${t.readable}`);
    expect(view.container.querySelector('[data-format=avif] .capability-value')?.textContent).toBe(`× ${t.unreadable}`);
    view.unmount();
  });
}
it('ignores completion after unmount', async () => {
  let finish!: (value: ImageCapabilities) => void;
  const view = render(<CapabilityList locale={ENGLISH_LOCALE} probe={() => new Promise(resolve => { finish = resolve; })} />);
  view.unmount();
  await act(async () => { finish(result); });
  expect(view.container.innerHTML).toBe('');
});
it('readiness and intake do not wait for an unfinished native probe', async () => {
  const decode = vi.fn(() => new Promise<never>(() => {}));
  vi.stubGlobal('createImageBitmap', decode);
  window.__toolReady = false;
  const view = render(<ImageConverter locale={ENGLISH_LOCALE} />);
  await waitFor(() => expect(window.__toolReady).toBe(true));
  expect(view.container.querySelector('input[type=file]')?.hasAttribute('disabled')).toBe(false);
});
