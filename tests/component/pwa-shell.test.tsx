import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { PwaStartup } from '../../src/ui/PwaStartup';
import { Workbench } from '../../src/app/Workbench';
import { ui, updateUi } from '../../src/i18n/ui';
import type { UpdateState } from '../../src/app/registerSW';

const update = vi.hoisted(() => {
  type State = { waiting: ServiceWorker | null; error: string | null; otherTabs: boolean;
    canCoordinate: boolean; applying: boolean; reloadDeferred: boolean };
  const initial: State = { waiting: null, error: null, otherTabs: false,
    canCoordinate: false, applying: false, reloadDeferred: false };
  const listeners = new Set<(state: State) => void>();
  return { initial, state: { ...initial }, listeners, register: vi.fn(), apply: vi.fn(), retry: vi.fn() };
});
vi.mock('../../src/app/registerSW', () => ({
  subscribeUpdate: (listener: (state: UpdateState) => void) => {
    update.listeners.add(listener); listener(update.state);
    return () => { update.listeners.delete(listener); };
  },
  registerSW: update.register,
  retrySW: update.retry,
  applyUpdate: update.apply,
  isUpdateApplying: () => update.state.applying,
}));

function setUpdate(next: Partial<UpdateState>) {
  act(() => {
    update.state = { ...update.state, ...next };
    for (const listener of update.listeners) listener(update.state);
  });
}
function installEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  return event;
}
function html(path: string) { return readFileSync(`dist/${path}index.html`, 'utf8'); }
function islands(markup: string) { return [...markup.matchAll(/<astro-island\b[^>]*>/g)].map(match => match[0]); }

beforeEach(() => {
  update.state = { ...update.initial };
  update.register.mockReset().mockResolvedValue(undefined);
  update.apply.mockReset().mockResolvedValue(false);
  update.retry.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('renders one load island on each hub and only the Workbench island on ZIP', () => {
  for (const path of ['', 'en/']) {
    const entries = islands(html(path));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('component-export="PwaStartup"');
    expect(entries[0]).toContain('client="load"');
    expect(entries[0]).not.toContain('Workbench');
  }
  for (const path of ['zip/', 'en/zip/']) {
    const entries = islands(html(path));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('component-export="Workbench"');
    expect(entries[0]).not.toContain('PwaStartup');
  }
});

it('keeps the hub island module graph separate from ZIP code', () => {
  const island = islands(html(''))[0];
  const entry = island.match(/component-url="\/_astro\/([^"]+)"/)?.[1];
  expect(entry).toBeTruthy();
  const visited = new Set<string>();
  const inspect = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    const code = readFileSync(`dist/_astro/${name}`, 'utf8');
    expect(code).not.toMatch(/Workbench|libarchive|worker-bundle/);
    for (const match of code.matchAll(/(?:from\s*|import\s*\()?["']\.\/([^"']+\.js)["']/g)) inspect(match[1]);
  };
  inspect(entry!);
});

it('starts registration on the hub after the install listener is attached', async () => {
  update.register.mockImplementation(() => { fireEvent(window, installEvent()); return Promise.resolve(); });
  expect(window.__toolReady).toBeUndefined();
  render(<PwaStartup locale="en" />);
  await waitFor(() => expect(update.register).toHaveBeenCalledOnce());
  expect(screen.getAllByRole('region', { name: ui.en.shared.installTitle })).toHaveLength(1);
  expect(window.__toolReady).toBeUndefined();
});

it('keeps hub updates blocked by other tabs, missing coordination, and application', () => {
  render(<PwaStartup locale="en" />);
  setUpdate({ waiting: { postMessage: vi.fn() } as unknown as ServiceWorker, canCoordinate: true });
  const button = screen.getByRole('button', { name: updateUi.en.now });
  expect(button).not.toHaveProperty('disabled', true);
  for (const state of [{ otherTabs: true }, { otherTabs: false, canCoordinate: false },
    { canCoordinate: true, applying: true }]) {
    setUpdate(state);
    expect(button).toHaveProperty('disabled', true);
  }
  setUpdate({ applying: false });
  expect(button).not.toHaveProperty('disabled', true);
  fireEvent.click(button);
  expect(update.apply).toHaveBeenCalledOnce();
  expect(update.apply.mock.calls[0][0]()).toBe(true);
});

it('uses the supplied ZIP safety check when the update is clicked', () => {
  const safe = vi.fn(() => false);
  render(<PwaStartup locale="en" busy={false} hasWork={false} isSafe={safe} />);
  setUpdate({ waiting: { postMessage: vi.fn() } as unknown as ServiceWorker, canCoordinate: true });
  fireEvent.click(screen.getByRole('button', { name: updateUi.en.now }));
  expect(update.apply.mock.calls[0][0]()).toBe(false);
  expect(safe).toHaveBeenCalledOnce();
});

it('retains both prompts and updates their language without remounting', () => {
  const view = render(<PwaStartup locale="ja" />);
  fireEvent(window, installEvent());
  setUpdate({ waiting: { postMessage: vi.fn() } as unknown as ServiceWorker, canCoordinate: true });
  expect(screen.getAllByRole('region', { name: ui.ja.shared.installTitle })).toHaveLength(1);
  expect(screen.getAllByRole('region', { name: updateUi.ja.title })).toHaveLength(1);
  view.rerender(<PwaStartup locale="en" />);
  expect(screen.getAllByRole('region', { name: ui.en.shared.installTitle })).toHaveLength(1);
  expect(screen.getAllByRole('region', { name: updateUi.en.title })).toHaveLength(1);
});

it('Workbench passes a check that reads changed work after an update click', async () => {
  render(<Workbench locale="en" />);
  setUpdate({ waiting: { postMessage: vi.fn() } as unknown as ServiceWorker, canCoordinate: true });
  fireEvent.click(screen.getByRole('button', { name: updateUi.en.now }));
  const safe = update.apply.mock.calls[0][0] as () => boolean;
  expect(safe()).toBe(true);
  const file = new File(['PK\x03\x04'], 'source.zip');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: () => new Promise<ArrayBuffer>(() => {}) } as Blob);
  fireEvent.change(screen.getByLabelText(ui.en.workbench.choose), { target: { files: [file] } });
  await waitFor(() => expect(safe()).toBe(false));
});

it('Workbench language changes retain the held offer and waiting update once each', () => {
  render(<Workbench locale="ja" />);
  fireEvent(window, installEvent());
  setUpdate({ waiting: { postMessage: vi.fn() } as unknown as ServiceWorker, canCoordinate: true });
  fireEvent.change(screen.getByLabelText(ui.ja.shared.language), { target: { value: 'en' } });
  expect(screen.getAllByRole('region', { name: ui.en.shared.installTitle })).toHaveLength(1);
  expect(screen.getAllByRole('region', { name: updateUi.en.title })).toHaveLength(1);
});

it('cleans subscriptions and registration timers on unmount', async () => {
  vi.useFakeTimers();
  try {
    const view = render(<PwaStartup locale="en" />);
    expect(update.listeners.size).toBe(1);
    view.unmount();
    expect(update.listeners.size).toBe(0);
    await vi.runAllTimersAsync();
    expect(update.register).not.toHaveBeenCalled();
    fireEvent(window, installEvent());
    expect(screen.queryByRole('region', { name: ui.en.shared.installTitle })).toBeNull();
  } finally { vi.useRealTimers(); }
});
