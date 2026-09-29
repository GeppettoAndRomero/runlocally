// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  vi.resetModules();
});

class Channel {
  static current: Channel;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() { Channel.current = this; }
  receive(type: string, id = 'other') { this.onmessage?.({ data: { type, id } } as MessageEvent); }
}
function locks() {
  let own = 0;
  let external = 0;
  return {
    setExternal(value: number) { external = value; },
    query: vi.fn(async () => ({ held: Array.from({ length: own + external }, () => ({ name: 'runlocally-pwa-tabs' })), pending: [] })),
    request: vi.fn(async (_name: string, options: { mode?: string; ifAvailable?: boolean }, callback: (lock: object | null) => Promise<void>) => {
      if (options.ifAvailable && own + external) return callback(null);
      own++;
      try { await callback({}); } finally { own--; }
    }),
  };
}
function setup(options: { waiting?: boolean; controller?: boolean; registrations?: Array<{ scope: string; unregister: () => Promise<boolean> }>; cacheNames?: string[] } = {}) {
  const order: string[] = [];
  const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), { scope: `${location.origin}/`, active: options.waiting ? {} : null, waiting: options.waiting ? worker : null, installing: worker,
    update: vi.fn(async () => { order.push('update'); }) });
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: options.controller === false ? null : {},
    getRegistrations: vi.fn(async () => options.registrations ?? []),
    register: vi.fn(async () => { order.push('register'); return registration; }),
  });
  let cacheNames = options.cacheNames ?? [];
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('BroadcastChannel', Channel);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  const lockManager = locks();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: lockManager });
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => cacheNames),
    delete: vi.fn(async (name: string) => { order.push(`delete:${name}`); cacheNames = cacheNames.filter(item => item !== name); return true; }),
  });
  return { order, worker, registration, serviceWorker, lockManager };
}
async function settled() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe('service worker migration and update', () => {
  it('removes prior scope and cache before registering once', async () => {
    const root = `${location.origin}/`;
    const prior = { scope: `${root}zip-viewer/`, unregister: vi.fn(async () => true) };
    const env = setup({ registrations: [{ scope: root, unregister: vi.fn(async () => true) }, prior], cacheNames: ['old', 'workbox-precache'] });
    const { registerSW } = await import('../../src/app/registerSW');
    await Promise.all([registerSW(), registerSW()]);
    expect(prior.unregister).toHaveBeenCalledOnce();
    expect(env.order).toEqual(['delete:old', 'register']);
  });
  it('continues when another tab has already removed a registration and cache', async () => {
    const prior = { scope: `${location.origin}/zip-viewer/`, unregister: vi.fn(async () => false) };
    const env = setup({ registrations: [prior], cacheNames: ['old'] });
    vi.mocked(env.serviceWorker.getRegistrations as () => Promise<unknown[]>).mockResolvedValueOnce([prior]).mockResolvedValue([]);
    vi.mocked(caches.delete).mockResolvedValue(false);
    vi.mocked(caches.keys).mockResolvedValueOnce(['old']).mockResolvedValue([]);
    const { registerSW } = await import('../../src/app/registerSW');
    await registerSW();
    expect(env.serviceWorker.register).toHaveBeenCalledOnce();
  });
  it('holds an update when another tab does not answer', async () => {
    const env = setup({ waiting: true });
    env.lockManager.setExternal(1);
    const { registerSW, applyUpdate, subscribeUpdate } = await import('../../src/app/registerSW');
    let canCoordinate = true;
    const stop = subscribeUpdate(state => { canCoordinate = state.canCoordinate; });
    await registerSW(); await settled();
    expect(canCoordinate).toBe(false);
    expect(await applyUpdate()).toBe(false);
    expect(env.worker.postMessage).not.toHaveBeenCalled();
    stop();
  });
  it('pauses input while applying and defers reload if work starts before controller change', async () => {
    const env = setup({ waiting: true });
    const { registerSW, applyUpdate, isUpdateApplying, subscribeUpdate } = await import('../../src/app/registerSW');
    await registerSW(); await settled();
    let safe = true;
    let deferred = false;
    const stop = subscribeUpdate(state => { deferred = state.reloadDeferred; });
    expect(await applyUpdate(() => safe)).toBe(true);
    expect(isUpdateApplying()).toBe(true);
    expect(env.worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    safe = false;
    Object.assign(env.serviceWorker, { controller: {} });
    env.serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(deferred).toBe(true);
    expect(isUpdateApplying()).toBe(false);
    stop();
  });
  it('reloads once after a safe controller change', async () => {
    const env = setup({ waiting: true });
    const { registerSW, applyUpdate } = await import('../../src/app/registerSW');
    await registerSW(); await settled();
    expect(await applyUpdate()).toBe(true);
    Object.assign(env.serviceWorker, { controller: {} });
    // jsdom reports navigation as unsupported, but the second event must not try again.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    env.serviceWorker.dispatchEvent(new Event('controllerchange'));
    env.serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
  it('shows initial install failure and retries the registration update', async () => {
    const env = setup();
    const { registerSW, subscribeUpdate } = await import('../../src/app/registerSW');
    let error: string | null = null;
    const stop = subscribeUpdate(state => { error = state.error; });
    await registerSW();
    Object.assign(env.worker, { state: 'redundant' });
    env.registration.dispatchEvent(new Event('updatefound'));
    env.worker.dispatchEvent(new Event('statechange'));
    expect(error).toContain('failed');
    await registerSW();
    expect(env.registration.update).toHaveBeenCalledOnce();
    stop();
  });
  it('restores input when activation cannot be requested', async () => {
    const env = setup({ waiting: true });
    env.worker.postMessage.mockImplementation(() => { throw new Error('send failed'); });
    const { registerSW, applyUpdate, isUpdateApplying, subscribeUpdate } = await import('../../src/app/registerSW');
    let error: string | null = null;
    const stop = subscribeUpdate(state => { error = state.error; });
    await registerSW(); await settled();
    expect(await applyUpdate()).toBe(false);
    expect(isUpdateApplying()).toBe(false);
    expect(error).toBe('send failed');
    stop();
  });
});
