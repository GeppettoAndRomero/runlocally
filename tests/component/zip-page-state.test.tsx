import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LOCALES } from '../../src/i18n/locales';
import { displayPage } from '../../src/app/page-display';
import { Workbench } from '../../src/app/Workbench';
import { pagePath } from '../../src/seo/page';
import { ZIP_PAGES } from '../../src/seo/url-model';

const engine = vi.hoisted(() => ({ list: vi.fn(), terminate: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: engine.list, terminate: engine.terminate }) }));

const root = document.documentElement;
const styleText = readFileSync(join(process.cwd(), 'src/styles/content.css'), 'utf8');
let style: HTMLStyleElement;

function cards() {
  return LOCALES.map(({ code }) => document.querySelector<HTMLElement>(`.operation-cards[data-lang="${code}"]`)!);
}

function visible(locale: 'ja' | 'en', top: boolean, open = false) {
  expect(root.lang).toBe(locale);
  expect(root.hasAttribute('data-zip-top')).toBe(top);
  expect(cards().map(card => getComputedStyle(card).display)).toEqual(
    LOCALES.map(({ code }) => top && !open && code === locale ? 'block' : 'none'),
  );
}

function chrome() {
  document.body.innerHTML = `
    <a data-chrome-home href="/zip/" aria-current="page">Home</a>
    <a data-chrome-page="browse" href="/zip/browse/">Browse</a>
    <a data-chrome-page="extract" href="/zip/extract/">Extract</a>
    <a data-chrome-locale="ja" href="/zip/">日本語</a>
    <a data-chrome-locale="en" href="/en/zip/">English</a>
    <h1 id="page-heading"></h1><section id="page-content"></section>
    <nav class="operation-cards" data-lang="ja"></nav>
    <nav class="operation-cards" data-lang="en"></nav>`;
}

function click(selector: string) {
  fireEvent.click(document.querySelector(selector)!);
}

function source(): File {
  const file = new File(['zip'], 'source.zip');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  return file;
}

beforeEach(() => {
  chrome();
  style = document.createElement('style');
  style.textContent = styleText;
  document.head.append(style);
  window.history.replaceState(null, '', pagePath('ja', 'top'));
  engine.list.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  style.remove();
  document.body.replaceChildren();
  root.removeAttribute('data-zip-top');
  root.removeAttribute('data-session');
  root.lang = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

for (const { code } of LOCALES) for (const page of ZIP_PAGES) {
  it(`${code}/${page} has the static ZIP top state`, () => {
    const html = readFileSync(join(process.cwd(), 'dist', pagePath(code, page).slice(1), 'index.html'), 'utf8');
    const initial = new JSDOM(html).window.document.documentElement;
    expect(initial.lang).toBe(code);
    expect(initial.hasAttribute('data-zip-top')).toBe(page === 'top');
  });
}

it('updates the root state before content lookup and leaves session state alone', () => {
  document.body.replaceChildren();
  root.dataset.session = 'open';
  for (const { code } of LOCALES) {
    displayPage(code, 'top');
    expect(root.lang).toBe(code);
    expect(root.hasAttribute('data-zip-top')).toBe(true);
    expect(root.dataset.session).toBe('open');
    for (const page of ZIP_PAGES.filter(page => page !== 'top')) {
      displayPage(code, page);
      expect(root.lang).toBe(code);
      expect(root.hasAttribute('data-zip-top')).toBe(false);
      expect(root.dataset.session).toBe('open');
      displayPage(code, 'top');
      expect(root.hasAttribute('data-zip-top')).toBe(true);
    }
  }
});

it('uses page, locale, and session state independently of the brand marker', () => {
  for (const { code } of LOCALES) {
    displayPage(code, 'top');
    visible(code, true);
    document.querySelector('[data-chrome-home]')!.removeAttribute('aria-current');
    visible(code, true);
    root.dataset.session = 'open';
    visible(code, true, true);
    root.removeAttribute('data-session');
    for (const page of ZIP_PAGES.filter(page => page !== 'top')) {
      displayPage(code, page);
      document.querySelector('[data-chrome-home]')!.setAttribute('aria-current', 'page');
      visible(code, false);
    }
  }
});

it('follows header links, locale links, history, intake, and reset', async () => {
  render(<Workbench locale="ja" />);
  await waitFor(() => visible('ja', true));
  click('[data-chrome-page="extract"]');
  await waitFor(() => visible('ja', false));
  click('[data-chrome-locale="en"]');
  await waitFor(() => visible('en', false));
  window.history.replaceState(null, '', pagePath('en', 'top'));
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => visible('en', true));

  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [source()] } });
  await waitFor(() => expect(root.dataset.session).toBe('open'));
  visible('en', true, true);
  click('[data-chrome-page="browse"]');
  await waitFor(() => visible('en', false, true));
  window.history.replaceState(null, '', pagePath('en', 'top'));
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => visible('en', true, true));
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => visible('en', true));
  expect(root.hasAttribute('data-session')).toBe(false);

  click('[data-chrome-page="extract"]');
  await waitFor(() => visible('en', false));
  fireEvent.change(screen.getByLabelText('Choose an archive'), { target: { files: [source()] } });
  await waitFor(() => visible('en', false, true));
  fireEvent.click(screen.getByRole('button', { name: /^Reset:/ }));
  await waitFor(() => visible('en', false));
  expect(root.hasAttribute('data-session')).toBe(false);
});
