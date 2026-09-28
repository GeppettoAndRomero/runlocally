import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { AppButton } from '@/ui/AppButton';
import { AppCard } from '@/ui/AppCard';
import { AppField } from '@/ui/AppField';
import { AppModal } from '@/ui/AppModal';
import { ThemeToggle } from '@/ui/ThemeToggle';
import { GlobalDropZone } from '@/ui/GlobalDropZone';
import { InstallPrompt } from '@/ui/InstallPrompt';

beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear() }); });
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.removeAttribute('data-theme'); document.body.style.overflow = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared controls', () => {
  it('keeps button behavior, card content and field associations', () => {
    const click = vi.fn(); const input = vi.fn();
    render(<><AppButton type="submit" variant="secondary" disabled onClick={click}>Save</AppButton>
      <AppCard title="Details" description="Description"><span>Content</span></AppCard>
      <AppField id="name" label="Name" value="" onChange={input} error="Invalid" helpText="Help" required /></>);
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.type).toBe('submit'); expect(button.disabled).toBe(true); expect(button.className).toContain('secondary');
    button.click(); expect(click).not.toHaveBeenCalled();
    expect(screen.getByText('Content')).toBeTruthy();
    const field = screen.getByLabelText(/Name/) as HTMLInputElement;
    expect(field.getAttribute('aria-describedby')).toBe('name-error name-help');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.input(field, { target: { value: 'Ada' } }); expect(input).toHaveBeenCalledWith('Ada');
  });
  it('closes modal by backdrop, button and Escape and restores scroll state', () => {
    const close = vi.fn(); document.body.style.overflow = 'scroll';
    const view = render(<AppModal isOpen title="Dialog" onClose={close}><span>Inside</span></AppModal>);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('Inside')); expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog').parentElement!); expect(close).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(close).toHaveBeenCalledTimes(3);
    view.unmount(); expect(document.body.style.overflow).toBe('scroll');
    fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(3);
  });
  it('loads auto theme, follows system changes, saves toggles and removes its listener', async () => {
    let change: (() => void) | undefined;
    const remove = vi.fn(); const media = { matches: false, addEventListener: (_: string, fn: () => void) => { change = fn; }, removeEventListener: remove };
    vi.stubGlobal('matchMedia', vi.fn(() => media)); localStorage.setItem('runlocally-theme', 'auto');
    const view = render(<ThemeToggle />);
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    media.matches = true; change?.();
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(localStorage.getItem('runlocally-theme')).toBe('light');
    view.unmount(); expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

describe('global file intake', () => {
  it('sends dropped and pasted files and clears processing', async () => {
    const received: File[][] = []; const listener = (event: Event) => received.push((event as CustomEvent<File[]>).detail);
    window.addEventListener('filesDropped', listener); const view = render(<GlobalDropZone />);
    const file = new File(['a'], 'a.txt');
    fireEvent.drop(document.body, { dataTransfer: { files: [file], items: [] } });
    expect(received[0]).toEqual([file]); expect(screen.getByRole('status').textContent).toContain('Checking files');
    window.dispatchEvent(new Event('filesProcessed')); await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    fireEvent.paste(document, { clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] } });
    expect(received[1]).toEqual([file]); view.unmount();
    fireEvent.drop(document.body, { dataTransfer: { files: [file], items: [] } }); expect(received).toHaveLength(2);
    window.removeEventListener('filesDropped', listener);
  });
  it('uses flat files when traversal fails or is empty', async () => {
    const file = new File(['a'], 'flat.txt');
    const received = vi.fn(); window.addEventListener('filesDropped', received);
    const view = render(<GlobalDropZone />);
    const failed = { isFile: false, isDirectory: true, createReader: () => ({ readEntries: (_ok: unknown, reject: (error: Error) => void) => reject(new Error('unavailable')) }) };
    fireEvent.drop(document.body, { dataTransfer: { files: [file], items: [{ webkitGetAsEntry: () => failed }] } });
    await waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    expect((received.mock.calls[0][0] as CustomEvent<File[]>).detail).toEqual([file]);
    window.dispatchEvent(new Event('filesProcessed'));
    const empty = { isFile: false, isDirectory: true, createReader: () => ({ readEntries: (ok: (files: unknown[]) => void) => ok([]) }) };
    fireEvent.drop(document.body, { dataTransfer: { files: [], items: [{ webkitGetAsEntry: () => empty }] } });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    view.unmount();
    window.removeEventListener('filesDropped', received);
  });
  it('sends a later folder result after an earlier filesProcessed event', async () => {
    const first = new File(['a'], 'first.txt');
    const later = new File(['b'], 'later.txt');
    let finishScan!: (file: File) => void;
    const entry = { isFile: true, isDirectory: false, fullPath: '/folder/later.txt', file: (ok: (file: File) => void) => { finishScan = ok; } };
    const received = vi.fn(); window.addEventListener('filesDropped', received);
    const view = render(<GlobalDropZone />);
    fireEvent.drop(document.body, { dataTransfer: { files: [first], items: [] } });
    fireEvent.drop(document.body, { dataTransfer: { files: [], items: [{ webkitGetAsEntry: () => entry }] } });
    window.dispatchEvent(new Event('filesProcessed'));
    expect(screen.getByRole('status')).toBeTruthy();
    finishScan(later);
    await waitFor(() => expect(received).toHaveBeenCalledTimes(2));
    expect((received.mock.calls[1][0] as CustomEvent<File[]>).detail).toEqual([later]);
    window.dispatchEvent(new Event('filesProcessed'));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    view.unmount(); window.removeEventListener('filesDropped', received);
  });
  it('suppresses a folder result after unmount and traversal completion', async () => {
    vi.useFakeTimers();
    try {
      const file = new File(['a'], 'pending.txt');
      const received = vi.fn(); window.addEventListener('filesDropped', received);
      const entry = { isFile: true, isDirectory: false, fullPath: '/folder/pending.txt', file: (ok: (file: File) => void) => { setTimeout(() => ok(file), 25); } };
      const view = render(<GlobalDropZone />);
      fireEvent.drop(document.body, { dataTransfer: { files: [], items: [{ webkitGetAsEntry: () => entry }] } });
      view.unmount();
      await vi.runAllTimersAsync();
      expect(received).not.toHaveBeenCalled();
      window.removeEventListener('filesDropped', received);
    } finally { vi.useRealTimers(); }
  });
  it('reads nested folders through multiple batches and preserves relative paths', async () => {
    const first = new File(['a'], 'a.txt'); const second = new File(['b'], 'b.txt');
    const leafA = { isFile: true, isDirectory: false, fullPath: '/folder/nested/a.txt', file: (ok: (f: File) => void) => ok(first) };
    const leafB = { isFile: true, isDirectory: false, fullPath: '/folder/nested/b.txt', file: (ok: (f: File) => void) => ok(second) };
    let calls = 0; const nested = { isFile: false, isDirectory: true, createReader: () => ({ readEntries: (ok: (entries: unknown[]) => void) => ok([ [leafA], [leafB], [] ][calls++]!) }) };
    let outerCalls = 0; const folder = { isFile: false, isDirectory: true, createReader: () => ({ readEntries: (ok: (entries: unknown[]) => void) => ok(++outerCalls === 1 ? [nested] : []) }) };
    const received = vi.fn(); window.addEventListener('filesDropped', received); const view = render(<GlobalDropZone />);
    fireEvent.drop(document.body, { dataTransfer: { files: [], items: [{ webkitGetAsEntry: () => folder }] } });
    await waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    const files = (received.mock.calls[0][0] as CustomEvent<File[]>).detail;
    expect(files).toEqual([first, second]);
    expect(files.map(file => file.webkitRelativePath)).toEqual(['folder/nested/a.txt', 'folder/nested/b.txt']);
    expect(calls).toBe(3); expect(outerCalls).toBe(2);
    view.unmount(); window.removeEventListener('filesDropped', received);
  });
});

describe('install prompt', () => {
  it('moves from banner to footer and stores a dismissed display preference', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    render(<InstallPrompt />);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(event);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Install app' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(localStorage.getItem('runlocally-install-prompt-mode')).toBe('footer');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(localStorage.getItem('runlocally-install-prompt-mode')).toBe('hidden');
    expect(localStorage.getItem('runlocally-install-prompt-dismissed')).toBeTruthy();
    expect(screen.queryByText('Install app')).toBeNull();
  });
  it('only appears for an available install event, prompts and clears listeners', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const prompt = vi.fn(async () => {}); const view = render(<InstallPrompt />);
    expect(screen.queryByText('Install app')).toBeNull();
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: typeof prompt; userChoice: Promise<{ outcome: string }> };
    event.prompt = prompt; event.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(event);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Install app')).toBeNull());
    expect(localStorage.getItem('runlocally-install-prompt-mode')).toBe('hidden');
    view.unmount(); window.dispatchEvent(event); expect(screen.queryByText('Install app')).toBeNull();
  });
});
