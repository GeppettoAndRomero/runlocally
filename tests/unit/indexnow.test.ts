import { readFileSync } from 'node:fs';
import type { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { changedUrls, KEY, KEY_LOCATION, notify, readManifest, revision } from '../../scripts/indexnow.mjs';

const previous = 'a'.repeat(40), target = 'b'.repeat(40);
const origin = 'https://runlocally.app';
const entry = (hash = '1111111111111111') => ({ hash, lastmod: null });
const old = { [`${origin}/`]: entry(), [`${origin}/about/`]: entry() };
const next = { [`${origin}/`]: entry('2222222222222222'), [`${origin}/en/`]: entry() };
const response = (status: number, text = KEY) => new Response(text, { status });
function harness(statuses: (number | Error)[] = [200]) {
  const post = vi.fn(async () => {
    const status = statuses.shift() ?? 200;
    if (status instanceof Error) throw status;
    return response(status);
  });
  const get = vi.fn(async (_url: string, options?: { method?: string; body?: string }) => options?.method === 'POST' ? post() : response(200));
  type State = { baseline?: boolean; status?: string; target?: string; urlList?: string[] };
  const records: Record<string, State> = {};
  const options = { read: vi.fn((sha: string): Record<string, ReturnType<typeof entry>> => sha === target ? next : old), get,
    observe: vi.fn(async () => target), sleep: vi.fn(),
    save: vi.fn(async (name: string, data: State) => { records[name] = structuredClone(data); }) };
  return { options, records, post, get };
}

describe('IndexNow CI notification', () => {
  it('compares content hashes for added, modified, removed and unchanged URLs', () => {
    expect(changedUrls(old, next)).toEqual([`${origin}/`, `${origin}/about/`, `${origin}/en/`]);
    expect(changedUrls(old, { ...old, [`${origin}/`]: { ...entry(), lastmod: '2026-11-17' } })).toEqual([]);
  });
  it('excludes image noindex, preview, assets, key files, queries and fragments', () => {
    const excluded = ['/image/', '/en/image/', '/icons/', '/_astro/', '/assets/', `/${KEY}.txt`, '/?x=1', '/#x'];
    expect(changedUrls({}, Object.fromEntries([...excluded.map(path => origin + path),
      'https://preview.runlocally.app/', 'https://runlocally.app.evil/'].map(url => [url, entry()])))).toEqual([]);
  });
  it('loads only the exact SHA manifests using git show', () => {
    const run = vi.fn(() => JSON.stringify(old));
    expect(readManifest(previous, run as unknown as typeof execFileSync)).toEqual(old);
    expect(run.mock.calls[0]).toEqual(['git', ['show', `${previous}:src/seo/lastmod.json`], expect.anything()]);
    expect(() => readManifest('HEAD^', run as unknown as typeof execFileSync)).toThrow('invalid');
  });
  it.each(['', previous])('records baseline without sending when comparison unavailable: %s', async sha => {
    const h = harness();
    if (sha) h.options.read.mockImplementation(value => { if (value !== target) throw Error('missing'); return next; });
    await notify(sha, target, h.options);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.records.deployed.baseline).toBe(true);
    expect(h.records.pending.status).toBe('baseline');
  });
  it('does not POST for zero changes or dry-run (including no state or network writes)', async () => {
    const h = harness();
    await notify(previous, target, { ...h.options, dryRun: true });
    expect(h.get).not.toHaveBeenCalled();
    expect(h.options.observe).not.toHaveBeenCalled();
    expect(h.options.save).not.toHaveBeenCalled();
    await notify(target, target, h.options);
    expect(h.post).not.toHaveBeenCalled();
  });
  it.each(['initial', 'missing-manifest', 'unchanged'])('verifies the public key without posting for %s', async mode => {
    const h = harness();
    if (mode === 'missing-manifest') h.options.read.mockImplementation(sha => { if (sha !== target) throw Error('missing'); return next; });
    await notify(mode === 'initial' ? '' : mode === 'unchanged' ? target : previous, target, h.options);
    expect(h.get).toHaveBeenCalledWith(KEY_LOCATION);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.records.pending.status).toBe(mode === 'unchanged' ? 'complete' : 'baseline');
  });
  it.each(['initial', 'missing-manifest', 'unchanged'].flatMap(mode => [404, 200].map(status => ({ mode, status }))))(
    'records failed key verification without posting for $mode with HTTP $status', async ({ mode, status }) => {
      const h = harness();
      if (mode === 'missing-manifest') h.options.read.mockImplementation(sha => { if (sha !== target) throw Error('missing'); return next; });
      h.get.mockResolvedValue(response(status, 'wrong'));
      await expect(notify(mode === 'initial' ? '' : mode === 'unchanged' ? target : previous, target, h.options)).rejects.toThrow('public key verification failed');
      expect(h.get).toHaveBeenCalledWith(KEY_LOCATION);
      expect(h.post).not.toHaveBeenCalled();
      expect(h.records.pending).toMatchObject({ status: 'pending', urlList: [], diagnostic: 'public key verification failed' });
      expect(h.records.deployed.target).toBe(target);
    });
  it.each([200, 202])('accepts HTTP %i and sends the official payload after key verification', async status => {
    const h = harness([status]);
    await notify(previous, target, h.options);
    expect(h.get.mock.calls[0][0]).toBe(KEY_LOCATION);
    const [url, options] = h.get.mock.calls[1];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options!.body!)).toEqual({ host: 'runlocally.app', key: KEY, keyLocation: KEY_LOCATION, urlList: changedUrls(old, next) });
    expect(h.records.pending).toMatchObject({ status: 'complete', urlList: [], diagnostic: `HTTP ${status}: ${status === 200 ? 'received' : 'key verification pending'}` });
    expect(readFileSync(new URL(`../../public/${KEY}.txt`, import.meta.url), 'utf8')).toBe(KEY);
  });
  it.each([response(404), response(200, 'wrong'), response(200, KEY + '\n')])('rejects inaccessible or mismatched key', async key => {
    const h = harness();
    h.get.mockResolvedValue(key);
    await expect(notify(previous, target, h.options)).rejects.toThrow('key verification');
    expect(h.post).not.toHaveBeenCalled();
    expect(h.records.pending.urlList).toEqual(changedUrls(old, next));
  });
  it.each([400, 403, 422])('retains pending and diagnostics without retry on HTTP %i', async status => {
    const h = harness([status]);
    await expect(notify(previous, target, h.options)).rejects.toThrow(`HTTP ${status}`);
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.options.sleep).not.toHaveBeenCalled();
    expect(h.records.pending.status).toBe('pending');
    expect(h.records.deployed.target).toBe(target);
  });
  it('retries key service and connection failures before sending', async () => {
    const h = harness();
    h.get.mockResolvedValueOnce(response(503)).mockRejectedValueOnce(new Error('connection failure'));
    await notify(previous, target, h.options);
    expect(h.options.sleep).toHaveBeenCalledTimes(2);
    expect(h.post).toHaveBeenCalledTimes(1);
  });
  it.each([429, 500, 503, new Error('network failure')])('bounds retries for transient failure %s', async failure => {
    const h = harness([failure, failure, failure]);
    await expect(notify(previous, target, h.options)).rejects.toThrow();
    expect(h.post).toHaveBeenCalledTimes(3);
    expect(h.options.sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(h.records.pending.urlList).toHaveLength(3);
  });
  it('retries then succeeds, but stops stale retries before another POST', async () => {
    const h = harness([429, 200]);
    await notify(previous, target, h.options);
    expect(h.post).toHaveBeenCalledTimes(2);
    const stale = harness([503]);
    stale.options.observe.mockResolvedValueOnce(target).mockResolvedValueOnce(target).mockResolvedValue(previous);
    await expect(notify(previous, target, stale.options)).rejects.toThrow('revision changed');
    expect(stale.post).toHaveBeenCalledTimes(1);
    expect(stale.records.pending.status).toBe('pending');
  });
  it('rejects stale production before any POST and verifies real build meta structure', async () => {
    const h = harness();
    h.options.observe.mockResolvedValue(previous);
    await expect(notify(previous, target, h.options)).rejects.toThrow('revision changed');
    expect(h.post).not.toHaveBeenCalled();
    expect(h.records.pending.status).toBe('pending');
    expect(h.records.deployed).toBeUndefined();
    const get = async () => new Response(`<html><head><meta name="build" content="${target}"></head></html>`, { headers: { 'content-type': 'text/html' } });
    expect(await revision(get)).toBe(target);
    await expect(revision(async () => new Response('', { status: 302 }))).rejects.toThrow();
  });
  it('keeps each batch within 10,000 and retains only the failed remainder', async () => {
    const h = harness([200, 422]);
    const large = Object.fromEntries(Array.from({ length: 10_001 }, (_, n) => [`${origin}/page-${n}/`, entry()]));
    h.options.read.mockImplementation(sha => sha === target ? large : {});
    await expect(notify(previous, target, h.options)).rejects.toThrow('HTTP 422');
    const sizes = h.get.mock.calls.filter(([, options]) => options?.method === 'POST')
      .map(([, options]) => JSON.parse(options!.body!).urlList.length);
    expect(sizes).toEqual([10_000, 1]);
    expect(h.records.pending.urlList).toHaveLength(1);
  });
});

it('gates CI notification on production, verified artifacts and every actual smoke outcome', () => {
  const yaml = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const publish = yaml.slice(yaml.indexOf('  publish:'));
  expect(publish).toContain('if: inputs.dry_run == false');
  expect(publish).toContain('needs: [prepare, verify-artifact]');
  expect(publish).toContain('environment: production');
  expect(publish).toContain('fetch-depth: 0');
  expect(publish.indexOf('--capture')).toBeLessThan(publish.indexOf('Deploy verified output'));
  const notification = publish.slice(publish.indexOf('      - id: indexnow'));
  const condition = notification.split('\n').find(line => line.trim().startsWith('if:'))!;
  for (const gate of ['inputs.dry_run == false', "vars.DEPLOY_ENABLED == 'true'", ...['meta_before', 'smoke', 'meta_after'].map(id => `steps.${id}.outcome == 'success'`)]) expect(condition).toContain(gate);
  expect(notification).toContain('continue-on-error: true');
  expect(notification).toContain('steps.previous_build.outputs.previous');
  expect(notification).toContain('path: indexnow-state/');
  expect(notification).toContain('always()');
});
