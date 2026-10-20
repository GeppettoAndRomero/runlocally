import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { EngineError } from '../../src/engine/errors';
import { pages as jaPages } from '../../src/i18n/ja/pages';
import { pages as enPages } from '../../src/i18n/en/pages';
import { ui } from '../../src/i18n/ui';
import type { Locale } from '../../src/i18n/locales';
import { menuName } from './_menu';

const mock = vi.hoisted(() => ({ zip: vi.fn(), open: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: mock.zip, openArchive: mock.open }));

async function load(locale: Locale) {
  const header = Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0]);
  const file = new File([header], 'sample.tar.gz');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => header.buffer } as Blob);
  render(<Workbench locale={locale} />);
  fireEvent.change(screen.getByLabelText(ui[locale].workbench.choose), { target: { files: [file] } });
  await screen.findByRole('alert');
  return file;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it.each(['ja', 'en'] as const)('shows retry guidance for an unreadable gzip archive in %s', async locale => {
  const t = ui[locale].workbench;
  mock.open.mockRejectedValue(new EngineError('unsupported'));
  const file = await load(locale);
  const expectFailure = () => {
    expect(screen.getByText('(gzip)')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(t.unsupported);
    expect(alert.textContent).toContain(t.listingTar);
    expect(screen.queryByText(t.listingUnknown, { exact: false })).toBeNull();
  };
  expectFailure();
  expect(screen.getByRole('tab', { name: menuName(locale, 'extract') })).toBeTruthy();
  expect(mock.open).toHaveBeenCalledTimes(1);
  expect(mock.open.mock.calls[0][0]).toBe(file);
  expect(mock.zip).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: `${t.retryListing}: ${file.name}` }));
  await waitFor(() => expect(mock.open).toHaveBeenCalledTimes(2));
  await screen.findByRole('alert');
  expect(mock.open.mock.calls[1][0]).toBe(file);
  expectFailure();
  expect(mock.zip).not.toHaveBeenCalled();
});

it.each([
  ['ja', jaPages],
  ['en', enPages],
] as const)('lists tar.gz and .tgz in the public input steps in %s', (_locale, pages) => {
  for (const page of ['top', 'browse'] as const) {
    expect(pages[page].steps[0].body).toContain('tar.gz');
    expect(pages[page].steps[0].body).toContain('.tgz');
  }
});
