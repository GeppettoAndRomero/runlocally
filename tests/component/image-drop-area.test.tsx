import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { DropArea } from '../../src/app/image/DropArea';
import { ImageConverter } from '../../src/app/image/ImageConverter';
import { imageToolContent } from '../../src/i18n/image-tool';

const pwa = vi.hoisted(() => ({ applying: false, listeners: new Set<(value: { applying: boolean }) => void>() }));
vi.mock('../../src/ui/PwaStartup', () => ({ PwaStartup: () => null }));
vi.mock('../../src/app/registerSW', () => ({ isUpdateApplying: () => pwa.applying,
  subscribeUpdate: (fn: (value: { applying: boolean }) => void) => {
    pwa.listeners.add(fn); fn({ applying: pwa.applying }); return () => pwa.listeners.delete(fn);
  } }));
afterEach(() => { cleanup(); pwa.applying = false; expect(pwa.listeners.size).toBe(0); });
const transfer = { dataTransfer: { types: ['Files'], files: [new File(['x'], 'picture.png')], items: [] } };

it.each(['ja', 'en'] as const)('tracks nested file drags and all termination paths in %s', locale => {
  const t = imageToolContent(locale);
  const view = render(<DropArea locale={locale} disabled={false} onChange={vi.fn()} />);
  const area = view.container.querySelector('label')!;
  const child = area.querySelector('strong')!;
  const active = () => expect(area.classList.contains('is-dragging')).toBe(true);
  const idle = () => { expect(area.classList.contains('is-dragging')).toBe(false); expect(area.textContent).toContain(t.input.idle); };
  fireEvent.dragEnter(area, { dataTransfer: { types: ['text/plain'] } }); idle();
  fireEvent.dragEnter(area, transfer); active(); expect(area.textContent).toContain(t.input.release);
  fireEvent.dragEnter(child, transfer); fireEvent.dragLeave(child, transfer); active();
  fireEvent.dragEnter(child, transfer); fireEvent.dragLeave(child, transfer); active();
  fireEvent.dragLeave(area, transfer); idle();
  for (const finish of [() => fireEvent.drop(document.body, transfer), () => fireEvent.dragEnd(document.body),
    () => fireEvent.dragOver(document.body, transfer), () => window.dispatchEvent(new Event('pagehide')),
    () => window.dispatchEvent(new Event('blur'))]) {
    fireEvent.dragEnter(area, transfer); active(); act(() => { finish(); }); idle();
  }
  fireEvent.dragOver(area, transfer); active(); fireEvent.dragLeave(area, transfer); idle();
  view.unmount();
  fireEvent.drop(document.body, transfer);
});

it('disables native intake initially and clears a drag when an update starts', () => {
  const change = vi.fn();
  const view = render(<DropArea locale="en" disabled onChange={change} />);
  const area = view.container.querySelector('label')!;
  const input = area.querySelector('input')!;
  expect(input.disabled).toBe(true); fireEvent.dragEnter(area, transfer);
  expect(area.classList.contains('is-dragging')).toBe(false);
  view.rerender(<DropArea locale="en" disabled={false} onChange={change} />);
  fireEvent.dragEnter(area, transfer); expect(area.classList.contains('is-dragging')).toBe(true);
  view.rerender(<DropArea locale="en" disabled onChange={change} />);
  expect(input.disabled).toBe(true); expect(area.classList.contains('is-dragging')).toBe(false);
  expect(area.classList.contains('is-disabled')).toBe(true);
});

it.each(['label', 'strong', 'input[type=file]'])('uses the real global receiver once for a drop on %s', async selector => {
  const convert = vi.fn(async () => ({ ok: true as const, value: new Blob(['output']) }));
  const save = vi.fn();
  const view = render(<ImageConverter locale="en" clientFactory={() => ({ convert, terminate: vi.fn(), stopped: false })} save={save} />);
  const area = view.container.querySelector('.image-drop-area')!;
  const target = selector === 'label' ? area : area.querySelector(selector)!;
  const received = vi.fn(); window.addEventListener('filesDropped', received);
  try {
    fireEvent.dragEnter(target, transfer);
    expect(area.classList.contains('is-dragging')).toBe(true);
    expect(view.container.querySelector('.global-drop-zone')).not.toBeNull();
    fireEvent.drop(target, transfer);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(received).toHaveBeenCalledTimes(1); expect(convert).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll('li')).toHaveLength(1);
    expect(area.classList.contains('is-dragging')).toBe(false);
    expect(view.container.querySelector('.global-drop-zone')).toBeNull();
  } finally { window.removeEventListener('filesDropped', received); }
});

it('keeps picker additions available during conversion and clears the value for reselection', async () => {
  let resolve!: (result: { ok: true; value: Blob }) => void;
  const convert = vi.fn(() => new Promise<{ ok: true; value: Blob }>(done => { resolve = done; }));
  const save = vi.fn();
  const view = render(<ImageConverter locale="en" clientFactory={() => ({ convert, terminate: vi.fn(), stopped: false })} save={save} />);
  const input = view.container.querySelector<HTMLInputElement>('input[type=file]')!;
  let value = 'selected';
  Object.defineProperty(input, 'value', { configurable: true, get: () => value, set: next => { value = next; } });
  fireEvent.change(input, { target: { files: transfer.dataTransfer.files } });
  expect(value).toBe(''); expect(input.disabled).toBe(false);
  fireEvent.change(input, { target: { files: transfer.dataTransfer.files } });
  expect(view.container.querySelectorAll('li')).toHaveLength(2);
  expect(convert).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: true, value: new Blob(['output']) }));
  await waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
  await act(async () => resolve({ ok: true, value: new Blob(['output']) }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  fireEvent.dragEnter(input, transfer);
  act(() => { pwa.applying = true; for (const listener of pwa.listeners) listener({ applying: true }); });
  expect(input.disabled).toBe(true);
  expect(view.container.querySelector('.is-dragging')).toBeNull();
});

it('opens the picker from the keyboard with Enter and Space only', () => {
  const view = render(<DropArea locale="en" disabled={false} onChange={() => {}} />);
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement;
  const click = vi.spyOn(input, 'click').mockImplementation(() => {});
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: ' ' });
  fireEvent.keyDown(input, { key: 'a' });
  expect(click).toHaveBeenCalledTimes(2);
});

it('keeps the highlight across nested moves after a drag resumes from a reset', () => {
  const view = render(<DropArea locale="en" disabled={false} onChange={() => {}} />);
  const area = view.container.querySelector('label')!;
  const child = area.querySelector('strong')!;
  fireEvent.dragEnter(area, transfer);
  fireEvent(window, new Event('blur'));
  expect(view.container.querySelector('.is-dragging')).toBeNull();
  fireEvent.dragOver(area, transfer);
  fireEvent.dragEnter(child, transfer);
  fireEvent.dragLeave(area, { ...transfer, relatedTarget: child });
  expect(view.container.querySelector('.is-dragging')).not.toBeNull();
  fireEvent.dragLeave(child, { ...transfer, relatedTarget: document.body });
  fireEvent.dragLeave(area, { ...transfer, relatedTarget: document.body });
  expect(view.container.querySelector('.is-dragging')).toBeNull();
});

it('removes every document and window listener it added, with the same handler and capture flag', () => {
  const added: unknown[][] = []; const removed: unknown[][] = [];
  const spies = [
    vi.spyOn(document, 'addEventListener').mockImplementation((...args) => { added.push(['document', ...args]); }),
    vi.spyOn(document, 'removeEventListener').mockImplementation((...args) => { removed.push(['document', ...args]); }),
    vi.spyOn(window, 'addEventListener').mockImplementation((...args) => { added.push(['window', ...args]); }),
    vi.spyOn(window, 'removeEventListener').mockImplementation((...args) => { removed.push(['window', ...args]); }),
  ];
  const view = render(<DropArea locale="en" disabled={false} onChange={() => {}} />);
  view.unmount();
  spies.forEach(spy => spy.mockRestore());
  // A listener added without options is removed without options; pad both to compare the capture flag.
  const pad = (call: unknown[]) => [call[0], call[1], call[2], call[3] ?? false];
  expect(added.length).toBeGreaterThan(0);
  for (const call of added) expect(removed.map(pad), `${String(call[0])} ${String(call[1])}`).toContainEqual(pad(call));
});

it('resets a drag in progress when disabled and starts clean when enabled again', () => {
  const view = render(<ImageConverter locale="en" clientFactory={() => ({ convert: vi.fn(), terminate: vi.fn() })} save={vi.fn()} />);
  const area = view.container.querySelector('.image-drop-area')!;
  fireEvent.dragEnter(area, transfer);
  expect(view.container.querySelector('.is-dragging')).not.toBeNull();
  act(() => { pwa.applying = true; for (const listener of pwa.listeners) listener({ applying: true }); });
  act(() => { pwa.applying = false; for (const listener of pwa.listeners) listener({ applying: false }); });
  expect(view.container.querySelector('.is-dragging')).toBeNull();
  fireEvent.dragEnter(area, transfer);
  expect(view.container.querySelector('.is-dragging')).not.toBeNull();
  fireEvent.dragLeave(area, { ...transfer, relatedTarget: document.body });
  expect(view.container.querySelector('.is-dragging')).toBeNull();
});
