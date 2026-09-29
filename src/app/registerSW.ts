export type UpdateState = {
  waiting: ServiceWorker | null; error: string | null; otherTabs: boolean;
  canCoordinate: boolean; applying: boolean; reloadDeferred: boolean;
};
const listeners = new Set<(state: UpdateState) => void>();
let state: UpdateState = { waiting: null, error: null, otherTabs: false, canCoordinate: false, applying: false, reloadDeferred: false };
let startPromise: Promise<void> | null = null;
let initialController: ServiceWorker | null = null;
let safetyCheck: (() => boolean) | null = null;
let reloaded = false;
let channel: BroadcastChannel | null = null;
let pulse: ReturnType<typeof setInterval> | null = null;
let resumeListening = false;
let hidden = false;
let releasePresence: (() => void) | null = null;
let presenceReady: Promise<void> | null = null;
let presenceFinished: Promise<void> | null = null;
let releaseExclusive: (() => void) | null = null;
let activationTimer: ReturnType<typeof setTimeout> | null = null;
const watchedRegistrations = new WeakSet<ServiceWorkerRegistration>();
const tabId = Math.random().toString(36).slice(2);
const lockName = 'runlocally-pwa-tabs';
const peers = new Set<string>();

function emit(next: Partial<UpdateState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}
export function subscribeUpdate(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => { listeners.delete(listener); };
}
export function isUpdateApplying(): boolean { return state.applying; }

async function presence(): Promise<void> {
  if (hidden || presenceReady || !navigator.locks) return presenceReady ?? Promise.resolve();
  let ready!: () => void;
  presenceReady = new Promise(resolve => { ready = resolve; });
  presenceFinished = navigator.locks.request(lockName, { mode: 'shared' }, async () => {
    if (hidden) { ready(); return; }
    await new Promise<void>(resolve => { releasePresence = resolve; ready(); });
    releasePresence = null;
  }).then(() => {}, () => { presenceReady = null; emit({ canCoordinate: false }); ready(); });
  return presenceReady;
}
async function inspectTabs(): Promise<void> {
  if (!channel || !navigator.locks || !releasePresence || releaseExclusive) {
    emit({ canCoordinate: false }); return;
  }
  try {
    const locks = await navigator.locks.query();
    const held = locks.held?.filter(lock => lock.name === lockName) ?? [];
    const pending = locks.pending?.filter(lock => lock.name === lockName) ?? [];
    emit({ canCoordinate: held.length === 1 && pending.length === 0 && peers.size === 0,
      otherTabs: held.length > 1 || pending.length > 0 || peers.size > 0 });
  } catch { emit({ canCoordinate: false }); }
}
function watchTabs() {
  hidden = false;
  if (!resumeListening) {
    window.addEventListener('pageshow', event => { if (event.persisted) watchTabs(); });
    resumeListening = true;
  }
  if (typeof BroadcastChannel === 'undefined' || !navigator.locks || channel) return;
  channel = new BroadcastChannel(lockName);
  channel.onmessage = event => {
    const data = event.data;
    if (!data || data.id === tabId) return;
    if (data.type === 'bye') peers.delete(data.id);
    else if (data.type === 'hello' || data.type === 'pulse') peers.add(data.id);
    else return;
    if (data.type === 'hello') channel?.postMessage({ type: 'pulse', id: tabId });
    void inspectTabs();
  };
  channel.postMessage({ type: 'hello', id: tabId });
  void presence().then(inspectTabs);
  pulse = setInterval(() => { channel?.postMessage({ type: 'pulse', id: tabId }); void inspectTabs(); }, 2000);
  window.addEventListener('pagehide', () => {
    hidden = true;
    channel?.postMessage({ type: 'bye', id: tabId });
    channel?.close(); channel = null;
    if (pulse) clearInterval(pulse);
    pulse = null;
    releasePresence?.(); releaseExclusive?.();
    presenceReady = null;
    emit({ canCoordinate: false });
  }, { once: true });
}
function finishApply(failed: boolean) {
  if (activationTimer) clearTimeout(activationTimer);
  activationTimer = null;
  releaseExclusive?.(); releaseExclusive = null;
  safetyCheck = null;
  emit({ applying: false, ...(failed ? { error: 'Update activation failed' } : {}) });
  void presence().then(inspectTabs);
}
async function start(): Promise<void> {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('caches' in window)) return;
  const retry = state.error !== null;
  emit({ error: null });
  watchTabs();
  initialController = navigator.serviceWorker.controller;
  const root = `${location.origin}/`;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    if (registration.scope === root) continue;
    if (!(await registration.unregister()) &&
        (await navigator.serviceWorker.getRegistrations()).some(current => current.scope === registration.scope)) {
      throw new Error(`Could not remove prior registration: ${registration.scope}`);
    }
  }
  for (const name of await caches.keys()) {
    if (name.startsWith('workbox-')) continue;
    if (!(await caches.delete(name)) && (await caches.keys()).includes(name)) {
      throw new Error(`Could not remove prior cache: ${name}`);
    }
  }
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const showWaiting = () => {
    if (registration.waiting && registration.active) emit({ waiting: registration.waiting, error: null });
  };
  showWaiting();
  if (watchedRegistrations.has(registration)) {
    showWaiting();
    if (retry) await registration.update();
    return;
  }
  watchedRegistrations.add(registration);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') showWaiting();
      if (worker.state === 'redundant') {
        startPromise = null;
        if (state.applying) finishApply(true);
        else emit({ error: 'Update installation failed' });
      }
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!state.applying || reloaded || !initialController || navigator.serviceWorker.controller === initialController) return;
    if (!safetyCheck?.()) {
      emit({ waiting: null, reloadDeferred: true });
      finishApply(false);
      return;
    }
    reloaded = true;
    finishApply(false);
    location.reload();
  });
}
export function registerSW(): Promise<void> {
  if (!startPromise) startPromise = start().catch(error => {
    emit({ error: error instanceof Error ? error.message : String(error) });
    startPromise = null;
  });
  return startPromise;
}
export function retrySW(): Promise<void> {
  startPromise = null;
  return registerSW();
}
export async function applyUpdate(isSafe: () => boolean = () => true): Promise<boolean> {
  if (!state.waiting || state.applying || !state.canCoordinate || !channel || !isSafe() || !releasePresence) return false;
  releasePresence();
  await presenceFinished;
  releasePresence = null;
  presenceReady = null;
  return new Promise(resolve => {
    void navigator.locks.request(lockName, { ifAvailable: true }, async lock => {
      if (!lock || !state.waiting || !isSafe()) { resolve(false); return; }
      const held = await navigator.locks.query();
      if ((held.held?.filter(item => item.name === lockName).length ?? 0) !== 1) { resolve(false); return; }
      await new Promise<void>(release => {
        releaseExclusive = release;
        safetyCheck = isSafe;
        emit({ applying: true, error: null, canCoordinate: false });
        try {
          state.waiting?.postMessage({ type: 'SKIP_WAITING' });
          activationTimer = setTimeout(() => { if (state.applying) finishApply(true); }, 15000);
          resolve(true);
        } catch (error) {
          emit({ error: error instanceof Error ? error.message : String(error) });
          finishApply(false);
          resolve(false);
        }
      });
    }).catch(error => {
      emit({ error: error instanceof Error ? error.message : String(error) });
      if (state.applying) finishApply(false);
      resolve(false);
    }).finally(() => { void presence().then(inspectTabs); });
  });
}
