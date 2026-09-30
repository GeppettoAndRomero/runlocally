import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { displayPage } from '../../src/app/page-display';
import { pageContent } from '../../src/i18n/pages';
import { pagePath } from '../../src/seo/page';
import type { ZipPage } from '../../src/seo/url-model';

vi.mock('../../src/seo/page', async importOriginal => {
  const page = await importOriginal<typeof import('../../src/seo/page')>();
  const model = await import('../../src/seo/url-model');
  return { ...page, publicPageFromPath: model.publicPageFromPath };
});
const engine = vi.hoisted(() => ({ list: vi.fn(), all: vi.fn(), terminate: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: engine.list, extractAll: engine.all, terminate: engine.terminate }) }));
vi.mock('../../src/app/download', () => ({ downloadBlob: vi.fn() }));

expectTypeOf<Parameters<typeof Workbench>[0]['page']>().toEqualTypeOf<ZipPage | undefined>();
expectTypeOf<Parameters<typeof pageContent>[1]>().toEqualTypeOf<ZipPage>();
expectTypeOf<Parameters<typeof displayPage>[1]>().toEqualTypeOf<ZipPage>();

const entry = { name: 'one.txt', size: 1, compressedSize: 1, directory: false, encrypted: false, utf8: true };
function source(): File {
  const file = new File(['zip'], 'source.zip');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return file;
}
function chrome() {
  document.body.innerHTML = '<a data-chrome-home></a><a data-chrome-page="extract"></a><a data-chrome-locale="ja"></a><a data-chrome-locale="en"></a><h1 id="page-heading"></h1><section id="page-content"></section>';
}
function clickPath(selector: string, path: string): boolean {
  const link = document.querySelector<HTMLAnchorElement>(selector)!;
  link.href = path;
  let prevented = false;
  const observe = (event: MouseEvent) => { prevented = event.defaultPrevented; event.preventDefault(); };
  window.addEventListener('click', observe);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  window.removeEventListener('click', observe);
  return prevented;
}
beforeEach(() => {
  chrome();
  window.history.replaceState(null, '', pagePath('ja', 'top'));
  engine.list.mockResolvedValue([entry]);
  engine.all.mockResolvedValue([{ name: 'one.txt', blob: new Blob(['ok']) }]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); delete document.documentElement.dataset.session; });

it.each(['ja', 'en'] as const)('leaves the %s hub link to ordinary navigation', async locale => {
  window.history.replaceState(null, '', pagePath(locale, 'top'));
  render(<Workbench locale={locale} />);
  await waitFor(() => expect(document.getElementById('page-heading')?.textContent).toBe(pageContent(locale, 'top').h1));
  const push = vi.spyOn(window.history, 'pushState');
  const replace = vi.spyOn(window.history, 'replaceState');
  expect(clickPath('[data-chrome-home]', locale === 'ja' ? '/' : '/en/')).toBe(false);
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe(pagePath(locale, 'top'));
});

it('captures ZIP operation and locale links and ignores hub history', async () => {
  render(<Workbench locale="ja" />);
  await waitFor(() => expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('ja', 'top').h1));
  const push = vi.spyOn(window.history, 'pushState');
  const replace = vi.spyOn(window.history, 'replaceState');
  expect(clickPath('[data-chrome-page="extract"]', pagePath('ja', 'extract'))).toBe(true);
  expect(window.location.pathname).toBe(pagePath('ja', 'extract'));
  await waitFor(() => expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('ja', 'extract').h1));
  expect(clickPath('[data-chrome-locale="en"]', pagePath('en', 'extract'))).toBe(true);
  expect(window.location.pathname).toBe(pagePath('en', 'extract'));
  await waitFor(() => expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('en', 'extract').h1));
  const input = source();
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [input] } });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Extract' }).getAttribute('aria-selected')).toBe('true'));
  const body = document.getElementById('page-content')?.textContent;
  expect(push).toHaveBeenCalledTimes(2);
  window.history.replaceState(null, '', '/en/');
  replace.mockClear();
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('en', 'extract').h1);
  expect(document.getElementById('page-content')?.textContent).toBe(body);
  expect(screen.getByLabelText('Language')).toHaveProperty('value', 'en');
  expect(screen.getByRole('tab', { name: 'Extract' }).getAttribute('aria-selected')).toBe('true');
  expect(push).toHaveBeenCalledTimes(2);
  expect(replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ja' } });
  await waitFor(() => expect(window.location.pathname).toBe(pagePath('ja', 'extract')));
  expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('ja', 'extract').h1);
  expect(push).toHaveBeenCalledTimes(3);
  window.history.replaceState(null, '', pagePath('ja', 'top'));
  replace.mockClear();
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('ja', 'top').h1));
  expect(push).toHaveBeenCalledTimes(3);
  expect(replace).not.toHaveBeenCalled();
});

it('keeps one File, listing, and result across ZIP language, operation, and history changes', async () => {
  window.history.replaceState(null, '', pagePath('en', 'extract'));
  const input = source();
  render(<Workbench locale="en" page="extract" op="extract" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [input] } });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Extract' }).getAttribute('aria-selected')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: /^Extract:/ }));
  await waitFor(() => expect(screen.getByText('1 files')).toBeTruthy());
  expect(engine.all.mock.calls[0][0]).toBe(input);
  expect(clickPath('[data-chrome-locale="ja"]', pagePath('ja', 'extract'))).toBe(true);
  expect(clickPath('[data-chrome-page="extract"]', pagePath('ja', 'browse'))).toBe(true);
  window.history.replaceState(null, '', pagePath('en', 'top'));
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Browse' }).getAttribute('aria-selected')).toBe('true'));
  await waitFor(() => expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('en', 'top').h1));
  expect(screen.getByText('source.zip')).toBeTruthy();
  expect(screen.getByText('1 files')).toBeTruthy();
  expect(engine.list).toHaveBeenCalledTimes(1);
  expect(engine.list.mock.calls[0][0]).toBe(input);
});
