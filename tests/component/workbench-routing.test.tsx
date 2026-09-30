import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { ui } from '../../src/i18n/ui';
import { menuName } from './_menu';
import { displayPage } from '../../src/app/page-display';
import { alternates, headData, pagePath } from '../../src/seo/page';
import { pageContent } from '../../src/i18n/pages';

const mock = vi.hoisted(() => ({ list: vi.fn(), all: vi.fn(), terminate: vi.fn(), open: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, extractAll: mock.all, terminate: mock.terminate }), openArchive: mock.open }));
vi.mock('../../src/app/download', () => ({ downloadBlob: vi.fn() }));
const entry = { name: 'one.txt', size: 1, compressedSize: 1, directory: false, encrypted: false, utf8: true };
function source(): File {
  const file = new File(['zip'], 'source.zip');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return file;
}
beforeEach(() => {
  window.history.replaceState(null, '', pagePath('ja', 'top'));
  mock.list.mockResolvedValue([entry]);
  mock.all.mockResolvedValue([{ name: 'one.txt', blob: new Blob(['ok']) }]);
  mock.open.mockResolvedValue({ entries: [{ path: 'one.txt', size: 1 }], close: vi.fn() });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); delete document.documentElement.dataset.session; });

it('keeps the initial operation and File through locale and history changes', async () => {
  window.history.replaceState(null, '', pagePath('ja', 'extract'));
  const input = source();
  const push = vi.spyOn(window.history, 'pushState');
  const view = render(<Workbench locale="ja" page="extract" op="extract" />);
  fireEvent.change(screen.getByLabelText('アーカイブを選択'), { target: { files: [input] } });
  await waitFor(() => expect(screen.getByRole('tab', { name: menuName('ja', 'extract') }).getAttribute('aria-selected')).toBe('true'));
  await screen.findByRole('button', { name: `${ui.ja.workbench.run}: source.zip` });
  expect(document.documentElement.dataset.session).toBe('open');
  expect(screen.getByRole('heading', { level: 2, name: '入力' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('言語'), { target: { value: 'en' } });
  expect(window.location.pathname).toBe(pagePath('en', 'extract'));
  expect(screen.getByRole('tab', { name: menuName('en', 'extract') }).getAttribute('aria-selected')).toBe('true');
  const run = await screen.findByRole('button', { name: /^Extract:/ });
  expect((run as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(run);
  await waitFor(() => expect(mock.all).toHaveBeenCalledTimes(1));
  expect(mock.all.mock.calls[0][0]).toBe(input);
  expect(screen.getByText('1 files')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 3, name: 'Extract' })).toBeTruthy();
  window.history.replaceState(null, '', pagePath('ja', 'browse'));
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  await waitFor(() => expect(screen.getByRole('tab', { name: menuName('ja', 'browse') }).getAttribute('aria-selected')).toBe('true'));
  expect(push).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('1件').length).toBeGreaterThan(0);
  expect(mock.list).toHaveBeenCalledTimes(1);
  expect(mock.list.mock.calls[0][0]).toBe(input);
  view.unmount();
  expect(document.documentElement.dataset.session).toBeUndefined();
  push.mockRestore();
});

it('routes tab, arrow, and entry changes through history without duplicate selection', async () => {
  const push = vi.spyOn(window.history, 'pushState');
  render(<Workbench locale="en" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [source()] } });
  expect(screen.getByRole('tab', { name: menuName('en', 'browse') })).toBeTruthy();
  await screen.findByRole('button', { name: /^Select for extraction:/ });
  fireEvent.click(screen.getByRole('button', { name: /^Select for extraction:/ }));
  expect(window.location.pathname).toBe(pagePath('en', 'extract'));
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(window.location.pathname).toBe(pagePath('en', 'remove'));
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'browse') }));
  expect(window.location.pathname).toBe(pagePath('en', 'browse'));
  expect(push).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('tab', { name: menuName('en', 'browse') }));
  expect(push).toHaveBeenCalledTimes(3);
  push.mockRestore();
});

it('replaces an unsupported operation URL for an archive and restores the current page after reset', async () => {
  window.history.replaceState(null, '', pagePath('en', 'remove'));
  const replace = vi.spyOn(window.history, 'replaceState');
  render(<Workbench locale="en" page="remove" op="remove" />);
  const file = new File(['rar'], 'source.rar');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([82, 97, 114, 33, 26, 7, 0]).buffer } as Blob);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [file] } });
  await waitFor(() => expect(window.location.pathname).toBe(pagePath('en', 'browse')));
  expect(replace).toHaveBeenCalledWith(null, '', pagePath('en', 'browse'));
  expect(screen.queryByRole('tab', { name: menuName('en', 'remove') })).toBeNull();
  expect(document.documentElement.dataset.session).toBe('open');
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => expect(document.documentElement.dataset.session).toBeUndefined());
  expect(window.location.pathname).toBe(pagePath('en', 'browse'));
  replace.mockRestore();
});

it('keeps a running job and its input while switching language', async () => {
  let finish!: (value: { name: string; blob: Blob }[]) => void;
  mock.all.mockReturnValue(new Promise(value => { finish = value; }));
  const input = source();
  render(<Workbench locale="en" page="extract" op="extract" />);
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [input] } });
  expect(screen.getByRole('tab', { name: menuName('en', 'extract') })).toBeTruthy();
  const run = await screen.findByRole('button', { name: /^Extract:/ });
  expect((run as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(run);
  await waitFor(() => expect(mock.all).toHaveBeenCalledTimes(1));
  expect(mock.all.mock.calls[0][0]).toBe(input);
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ja' } });
  expect(mock.all).toHaveBeenCalledTimes(1);
  finish([{ name: 'one.txt', blob: new Blob(['ok']) }]);
  await waitFor(() => expect(screen.getAllByText('1件').length).toBeGreaterThan(0));
  expect(mock.list).toHaveBeenCalledTimes(1);
  expect(mock.list.mock.calls[0][0]).toBe(input);
});

it('requires identity because call matching accepts a different File with equal contents', () => {
  const first = new File(['same'], 'archive.zip');
  const second = new File(['same'], 'archive.zip');
  const callback = vi.fn();
  callback(first);
  expect(first).not.toBe(second);
  expect(callback).toHaveBeenCalledWith(second);
  expect(callback.mock.calls[0][0]).toBe(first);
});

it('updates the current page copy and existing head nodes without duplicates', () => {
  document.head.innerHTML = `<meta name="description"><link rel="canonical">${alternates('top').map(link =>
    `<link rel="alternate" hreflang="${link.hreflang}">`).join('')}<meta property="og:url"><meta property="og:title"><meta property="og:description"><meta property="og:locale"><meta property="og:locale:alternate"><script type="application/ld+json"></script>`;
  document.body.innerHTML = '<h1 id="page-heading"></h1><section id="page-content"></section><footer><a id="footer-security" href="/SECURITY.md">Security</a></footer>';
  displayPage('en', 'extract');
  displayPage('ja', 'remove');
  const expected = headData('ja', 'remove', pageContent('ja', 'remove'));
  expect(document.documentElement.lang).toBe('ja');
  expect(document.getElementById('footer-security')?.textContent).toBe('セキュリティ');
  expect(document.title).toBe(expected.title);
  expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(expected.description);
  expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(expected.canonical);
  for (const link of expected.alternates) {
    expect(document.querySelector(`link[hreflang="${link.hreflang}"]`)?.getAttribute('href')).toBe(link.href);
  }
  expect(document.querySelector('script[type="application/ld+json"]')?.textContent).toBe(expected.jsonLd);
  expect(document.getElementById('page-heading')?.textContent).toBe(pageContent('ja', 'remove').h1);
  expect(document.getElementById('page-content')?.textContent).toContain(pageContent('ja', 'remove').lead);
  expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
});
