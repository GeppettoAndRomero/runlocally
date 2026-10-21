import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { ImageConverter } from '../../src/app/image/ImageConverter';
import { ENGLISH_LOCALE, DEFAULT_LOCALE, type Locale } from '../../src/i18n/locales';
import { imageToolContent } from '../../src/i18n/image-tool';
import type { ImageClient } from '../../src/app/image/client';
import type { ImageResult, ImageErrorCode, ImageOutputFormat } from '../../src/engine/image/types';

const pwa = vi.hoisted(() => ({ props: { busy: false, hasWork: false, isSafe: () => true }, applying: false,
  listeners: new Set<(value: { applying: boolean }) => void>() }));
vi.mock('../../src/ui/PwaStartup', () => ({ PwaStartup: (props: typeof pwa.props) => { pwa.props = props; return null; } }));
vi.mock('../../src/app/registerSW', () => ({ isUpdateApplying: () => pwa.applying,
  subscribeUpdate: (fn: (value: { applying: boolean }) => void) => {
    pwa.listeners.add(fn); fn({ applying: pwa.applying }); return () => pwa.listeners.delete(fn);
  } }));
const saved = () => ({ ok: true, value: new Blob(['output']) } as const);
function deferred() {
  let resolve!: (value: ImageResult<Blob>) => void;
  const promise = new Promise<ImageResult<Blob>>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(locale: Locale = ENGLISH_LOCALE) {
  const calls: ReturnType<typeof deferred>[] = [];
  const convert = vi.fn((_input: Blob, _format: ImageOutputFormat) => { const call = deferred(); calls.push(call); return call.promise; });
  const terminate = vi.fn();
  const client: ImageClient & { stopped: boolean } = { convert, terminate, stopped: false };
  const factory = vi.fn(() => client);
  const save = vi.fn();
  const view = render(<ImageConverter locale={locale} clientFactory={factory} save={save} />);
  const input = view.container.querySelector('input[type=file]')!;
  const select = (...names: string[]) => fireEvent.change(input, { target: { files: names.map(name => new File(['bytes'], name)) } });
  return { ...view, input, select, calls, convert, terminate, factory, save, client };
}
beforeEach(() => { pwa.applying = false; });
afterEach(() => { cleanup(); expect(pwa.listeners.size).toBe(0); });

it('serializes intake, locks format, immediately acknowledges and saves unique names', async () => {
  const s = setup();
  expect((screen.getByLabelText('JPG') as HTMLInputElement).checked).toBe(true);
  expect(s.input.getAttribute('multiple')).not.toBeNull();
  expect(s.input.getAttribute('accept')).toBe('image/*,.heic,.heif,.avif');
  fireEvent.click(screen.getByLabelText('PNG'));
  s.select('a.jpg', 'a(1).jpg');
  expect(pwa.props.isSafe()).toBe(false);
  expect(pwa.props.busy).toBe(true); expect(pwa.props.hasWork).toBe(true);
  expect(s.container.textContent).toContain('Converting');
  expect(s.container.textContent).toContain('Waiting');
  expect(s.container.querySelector<HTMLInputElement>('input[type=file]')?.value).toBe('');
  await waitFor(() => expect(s.convert).toHaveBeenCalledTimes(1));
  expect(s.convert.mock.calls[0][1]).toBe('png');
  expect(screen.getByLabelText('JPG').closest('fieldset')?.disabled).toBe(true);
  const ack = vi.fn(); window.addEventListener('filesProcessed', ack);
  act(() => { window.dispatchEvent(new CustomEvent('filesDropped', { detail: [new File(['x'], 'a.jpg')] })); });
  expect(ack).toHaveBeenCalledTimes(1);
  expect(s.convert).toHaveBeenCalledTimes(1);
  await act(async () => s.calls[0].resolve(saved()));
  await waitFor(() => expect(s.convert).toHaveBeenCalledTimes(2));
  await act(async () => s.calls[1].resolve(saved()));
  await waitFor(() => expect(s.convert).toHaveBeenCalledTimes(3));
  await act(async () => s.calls[2].resolve(saved()));
  await waitFor(() => expect(pwa.props.isSafe()).toBe(true));
  expect(s.save.mock.calls.map(call => call[1])).toEqual(['a.png', 'a(1).png', 'a(2).png']);
  expect(pwa.props.busy).toBe(false); expect(pwa.props.hasWork).toBe(false);
  expect(screen.getByLabelText('JPG').closest('fieldset')?.disabled).toBe(false);
  fireEvent.click(screen.getByLabelText('JPG'));
  s.select('a.png');
  await waitFor(() => expect(s.calls.length).toBe(4));
  await act(async () => s.calls[3].resolve(saved()));
  await waitFor(() => expect(s.save.mock.calls[3][1]).toBe('a.jpg'));
  expect(ack).toHaveBeenCalledTimes(1);
  window.removeEventListener('filesProcessed', ack);
});

it('uses the real drop and paste handlers exactly once per file', async () => {
  const s = setup();
  const files = [new File(['x'], 'one'), new File(['x'], 'two')];
  fireEvent.drop(document.body, { dataTransfer: { files, items: [] } });
  fireEvent.paste(document, { clipboardData: { items: files.map(file => ({ kind: 'file', getAsFile: () => file })) } });
  for (let index = 0; index < 4; index++) {
    await waitFor(() => expect(s.calls.length).toBe(index + 1));
    await act(async () => s.calls[index].resolve(saved()));
  }
  await waitFor(() => expect(s.save).toHaveBeenCalledTimes(4));
  expect(s.convert).toHaveBeenCalledTimes(4);
});

it('interrupts departure, ignores late success and creates a fresh client after return', async () => {
  const s = setup(); s.select('one', 'two');
  await waitFor(() => expect(s.calls.length).toBe(1));
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  expect(window.__toolReady).toBe(false); expect(s.terminate).toHaveBeenCalledTimes(1);
  await act(async () => s.calls[0].resolve(saved()));
  expect(s.save).not.toHaveBeenCalled(); expect(s.convert).toHaveBeenCalledTimes(1);
  act(() => { window.dispatchEvent(new Event('pageshow')); });
  expect(window.__toolReady).toBe(true);
  s.select('three'); await waitFor(() => expect(s.factory).toHaveBeenCalledTimes(2));
  s.unmount(); expect(window.__toolReady).toBe(false);
});

it('does not let a late result from before departure act on work started after the return', async () => {
  const s = setup(); s.select('one');
  await waitFor(() => expect(s.calls.length).toBe(1));
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  act(() => { window.dispatchEvent(new Event('pageshow')); });
  s.select('two'); await waitFor(() => expect(s.calls.length).toBe(2));
  await act(async () => s.calls[0].resolve(saved()));
  expect(s.save).not.toHaveBeenCalled();
  expect((screen.getByLabelText('JPG') as HTMLInputElement).matches(':disabled')).toBe(true);
  await act(async () => s.calls[1].resolve(saved()));
  await waitFor(() => expect(s.save).toHaveBeenCalledTimes(1));
});

it('creates a fresh client for later inputs once the previous one has stopped', async () => {
  const s = setup(); s.select('one');
  await waitFor(() => expect(s.calls.length).toBe(1));
  s.client.stopped = true;
  await act(async () => s.calls[0].resolve({ ok: false, code: 'interrupted' }));
  await waitFor(() => expect((screen.getByLabelText('JPG') as HTMLInputElement).matches(':disabled')).toBe(false));
  s.select('two');
  await waitFor(() => expect(s.factory).toHaveBeenCalledTimes(2));
});

it('blocks all intake during updates and acknowledges refused notifications', async () => {
  const s = setup(); expect(window.__toolReady).toBe(true);
  act(() => { pwa.applying = true; for (const fn of pwa.listeners) fn({ applying: true }); });
  expect(window.__toolReady).toBe(false);
  s.select('one');
  const ack = vi.fn(); window.addEventListener('filesProcessed', ack);
  act(() => { window.dispatchEvent(new CustomEvent('filesDropped', { detail: [new File(['x'], 'two')] })); });
  expect(ack).toHaveBeenCalledTimes(1); expect(s.convert).not.toHaveBeenCalled();
  window.removeEventListener('filesProcessed', ack);
});

it.each([ENGLISH_LOCALE, DEFAULT_LOCALE])('renders every error and continues after save failure in %s', async locale => {
  const s = setup(locale); const t = imageToolContent(locale);
  const codes: ImageErrorCode[] = ['unsupported-type', 'decode-failed', 'heic-decoder-unavailable', 'too-large', 'out-of-memory', 'encode-failed', 'interrupted'];
  s.select(...codes);
  for (const [index, code] of codes.entries()) {
    await waitFor(() => expect(s.calls.length).toBe(index + 1));
    await act(async () => s.calls[index].resolve({ ok: false, code }));
    await waitFor(() => expect(screen.getByText(`— ${t.errors[code]}`)).toBeTruthy());
  }
  expect(screen.queryByText(t.notices.avif)).toBeNull();
  s.save.mockImplementationOnce(() => { throw new Error('save'); });
  s.select('<img>.jpg', 'next.jpg');
  await waitFor(() => expect(s.calls.length).toBe(8));
  await act(async () => s.calls[7].resolve(saved()));
  await waitFor(() => expect(s.calls.length).toBe(9));
  await act(async () => s.calls[8].resolve(saved()));
  await waitFor(() => expect(screen.getByText('<img>.jpg')).toBeTruthy());
  expect(s.container.querySelector('img')).toBeNull(); expect(s.save).toHaveBeenCalledTimes(2);
  expect(screen.getByText('<img>.jpg').closest('li')!.textContent).toContain(t.statuses.failed);
  expect(screen.getByText('<img>.jpg').closest('li')!.textContent).not.toContain(t.statuses.saved);
  expect(screen.getByText('next.jpg').closest('li')!.textContent).toContain(t.statuses.saved);
});

it('does not start reading a whole file after the page was left during the prefix read', async () => {
  const s = setup();
  const whole = vi.fn(async () => new ArrayBuffer(70_000));
  const file = new File(['x'], 'large.png');
  Object.defineProperties(file, { size: { value: 70_000 }, arrayBuffer: { value: whole },
    slice: { value: () => ({ arrayBuffer: async () => { window.dispatchEvent(new Event('pagehide')); return new ArrayBuffer(65_536); } }) } });
  fireEvent.change(s.input, { target: { files: [file] } });
  await waitFor(() => expect(s.calls.length).toBe(1));
  await act(async () => s.calls[0].resolve({ ok: false, code: 'decode-failed' }));
  await waitFor(() => expect(s.terminate).toHaveBeenCalled());
  expect(whole).not.toHaveBeenCalled();
});

it('uses bytes for AVIF guidance, including a format box beyond the prefix', async () => {
  const s = setup(); const t = imageToolContent(ENGLISH_LOCALE);
  const avif = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0, 97, 118, 105, 102]);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const file = (name: string, bytes: Uint8Array, large = false) => {
    const input = new File(['x'], name);
    Object.defineProperties(input, { size: { value: large ? 70_000 : bytes.length },
      slice: { value: () => ({ arrayBuffer: async () => large ? new ArrayBuffer(65_536) : bytes.buffer }) },
      arrayBuffer: { value: async () => bytes.buffer } });
    return input;
  };
  fireEvent.change(s.input, { target: { files: [file('misleading.png', avif, true), file('fake.avif', png)] } });
  await waitFor(() => expect(s.calls.length).toBe(1));
  await act(async () => s.calls[0].resolve({ ok: false, code: 'decode-failed' }));
  await waitFor(() => expect(s.calls.length).toBe(2));
  await act(async () => s.calls[1].resolve({ ok: false, code: 'decode-failed' }));
  await waitFor(() => expect(screen.getAllByText(t.notices.avif)).toHaveLength(1));
});
