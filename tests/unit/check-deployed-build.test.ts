import { describe, expect, it, vi } from 'vitest';
import { checkDocument, curlRequest, verifyUrl } from '../../scripts/check-deployed-build.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const html = (tag: string) => `<!doctype html><html><head>${tag}</head><body></body></html>`;
const meta = (value = sha) => `<meta name="build" content="${value}">`;

describe('deployed build', () => {
  it('accepts one exact head meta with varied attribute syntax', () => {
    expect(checkDocument(html(`<meta content='${sha}' name='build'>`), sha)).toBe(sha);
  });
  it.each([
    ['', 'count'],
    [meta() + meta(), 'count'],
    [`</head><body>${meta()}</body><head>`, 'outside head'],
    [meta('a'.repeat(7)), 'invalid observed'],
    [meta('dev'), 'invalid observed'],
    [meta('bad'), 'invalid observed'],
    [`<!-- ${meta()} -->`, 'count'],
  ])('rejects malformed build meta: %s', (tag, error) => {
    expect(() => checkDocument(html(tag), sha)).toThrow(error);
  });
  it('rejects mismatched and shortened expected SHA', () => {
    expect(() => checkDocument(html(meta(other)), sha)).toThrow('SHA mismatch');
    expect(() => checkDocument(html(meta()), sha.slice(0, 7))).toThrow('invalid expected');
  });
  it('retries mismatch and transient HTTP errors, then succeeds', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 503, contentType: 'text/html', body: '' })
      .mockResolvedValueOnce({ status: 200, contentType: 'text/html', body: html(meta(other)) })
      .mockResolvedValue({ status: 200, contentType: 'text/html; charset=utf-8', body: html(meta()) });
    const sleep = vi.fn();
    await verifyUrl(sha, { request, sleep, now: () => 0 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('https://runlocally.app/');
  });
  it.each([301, 302, 404])('rejects HTTP %i without retry', async status => {
    const request = vi.fn().mockResolvedValue({ status, contentType: 'text/html', body: html(meta()) });
    await expect(verifyUrl(sha, { request, sleep: vi.fn() })).rejects.toThrow(status === 404 ? 'HTTP 404' : 'redirect rejected');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects non-HTML and missing meta immediately', async () => {
    await expect(verifyUrl(sha, { request: async () => ({ status: 200, contentType: 'text/plain', body: html(meta()) }) })).rejects.toThrow('non-HTML');
    await expect(verifyUrl(sha, { request: async () => ({ status: 200, contentType: 'text/html', body: html('') }) })).rejects.toThrow('count');
  });
  it('stops at retry limit', async () => {
    const request = vi.fn().mockResolvedValue({ status: 500, contentType: 'text/html', body: '' });
    await expect(verifyUrl(sha, { request, sleep: vi.fn(), now: () => 0, attempts: 3 })).rejects.toThrow('exhausted after 3');
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('curl request', () => {
  const run = (output: string) => vi.fn().mockReturnValue(output);
  it('does not follow redirects, bypasses caches and bounds the time', () => {
    const exec = run('HTTP/2 200\r\ncontent-type: text/html\r\n\r\n<html></html>');
    curlRequest('https://runlocally.app/', exec);
    const [command, args] = exec.mock.calls[0];
    expect(command).toBe('curl');
    expect(args).not.toContain('-L');
    expect(args).not.toContain('--location');
    expect(args).toEqual(expect.arrayContaining(['--max-time', '10', '--header', 'Cache-Control: no-cache']));
    expect(args.at(-1)).toBe('https://runlocally.app/');
  });
  it('reports a raw 3xx as the final status and skips 1xx blocks', () => {
    expect(curlRequest('https://runlocally.app/', run('HTTP/2 301\r\nlocation: https://example.invalid/\r\n\r\n')).status).toBe(301);
    const twoBlocks = 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\n\r\nbody';
    expect(curlRequest('https://runlocally.app/', run(twoBlocks))).toMatchObject({ status: 200, contentType: 'text/html; charset=utf-8', body: 'body' });
  });
});
