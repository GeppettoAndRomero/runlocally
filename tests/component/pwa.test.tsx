import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/preact';
import { InstallPrompt } from '../../src/ui/InstallPrompt';
import { UpdatePrompt } from '../../src/ui/UpdatePrompt';
import { GlobalDropZone } from '../../src/ui/GlobalDropZone';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
});

describe('installation and update interface', () => {
  it('only offers installation after the browser event and hides after install', async () => {
    render(<InstallPrompt locale="ja" />);
    expect(screen.queryByText('インストール')).toBeNull();
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'accepted' }) });
    fireEvent(window, event);
    expect(screen.getByText('インストール')).toBeTruthy();
    fireEvent(window, new Event('appinstalled'));
    expect(screen.queryByText('インストール')).toBeNull();
  });
  it('uses the current language for an installation offer', () => {
    const view = render(<InstallPrompt locale="ja" />);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    fireEvent(window, event);
    expect(screen.getByText('アプリをインストール')).toBeTruthy();
    view.rerender(<InstallPrompt locale="en" />);
    expect(screen.getByText('Install app')).toBeTruthy();
  });
  it('keeps the update control out of view without a waiting worker', () => {
    render(<UpdatePrompt locale="en" busy={false} hasWork={false} />);
    expect(screen.queryByText('An update is available')).toBeNull();
  });
  it('does not emit dropped files while an update is applying', () => {
    const received = vi.fn();
    window.addEventListener('filesDropped', received);
    render(<GlobalDropZone locale="en" disabled />);
    fireEvent.drop(document.body, { dataTransfer: { files: [new File(['zip'], 'test.zip')], items: [] } });
    expect(received).not.toHaveBeenCalled();
    window.removeEventListener('filesDropped', received);
  });
  it('shows registration errors without a waiting worker and retries', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('caches', { keys: async () => [], delete: vi.fn() });
    const registration = Object.assign(new EventTarget(), { active: null, waiting: null });
    const register = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(registration);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: Object.assign(new EventTarget(), {
      controller: null, getRegistrations: async () => [], register,
    }) });
    render(<UpdatePrompt locale="en" busy={false} hasWork={false} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
  });
});
