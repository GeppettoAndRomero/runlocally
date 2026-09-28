import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineError } from '../../src/engine/errors';
import { __setArchiveForTesting, openArchive } from '../../src/engine/archive/libarchive';
import type { Archive } from 'libarchive.js';

const input = () => new File(['bytes'], 'test.tar');
const failure = new Error('library failed');

function fixture() {
  const close = vi.fn();
  const extractA = vi.fn(async () => new File(['a'], 'a.txt'));
  const extractB = vi.fn(async () => new File(['b'], 'b.txt'));
  const archive = {
    hasEncryptedData: vi.fn(async () => false),
    getFilesArray: vi.fn(async () => [
      { path: 'z/', file: { name: 'b.txt', size: 1, extract: extractB } },
      { path: 'a/', file: { name: 'a.txt', size: 1, extract: extractA } },
    ]),
    close,
  };
  const open = vi.fn(async () => archive);
  __setArchiveForTesting({ open } as unknown as typeof Archive);
  return { archive, open, close, extractA, extractB };
}

beforeEach(() => { fixture(); });

async function errorOf(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error as EngineError; }
  throw new Error('Expected rejection');
}

describe('archive library failures', () => {
  it('classifies open failure and keeps its cause', async () => {
    const { open } = fixture();
    open.mockRejectedValueOnce(failure);
    const error = await errorOf(openArchive(input()));
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe('unsupported');
    expect(error.cause).toBe(failure);
  });

  it('closes on encrypted detection', async () => {
    const { archive, close } = fixture();
    archive.hasEncryptedData.mockResolvedValueOnce(true);
    expect((await errorOf(openArchive(input()))).code).toBe('encrypted-entry');
    expect(close).toHaveBeenCalledOnce();
    expect(archive.getFilesArray).not.toHaveBeenCalled();
  });

  it('continues listing when the encryption inquiry fails', async () => {
    const { archive, close } = fixture();
    archive.hasEncryptedData.mockRejectedValueOnce(failure);
    const handle = await openArchive(input());
    expect(handle.entries).toHaveLength(2);
    expect(archive.getFilesArray).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    handle.close();
  });

  it('closes on listing failure and keeps its cause', async () => {
    const { archive, close } = fixture();
    archive.getFilesArray.mockRejectedValueOnce(failure);
    const error = await errorOf(openArchive(input()));
    expect(error.code).toBe('unsupported');
    expect(error.cause).toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes on an empty listing without claiming corruption', async () => {
    const { archive, close } = fixture();
    archive.getFilesArray.mockResolvedValueOnce([]);
    const error = await errorOf(openArchive(input()));
    expect(error.code).toBe('unsupported');
    expect(error.message).toContain('No extractable files');
    expect(close).toHaveBeenCalledOnce();
  });

  it('retains full paths, collapses duplicate paths, and sorts the listing', async () => {
    const { archive } = fixture();
    archive.getFilesArray.mockResolvedValueOnce([
      { path: 'z/', file: { name: 'b.txt', size: 1, extract: vi.fn() } },
      { path: 'z/', file: { name: 'b.txt', size: 2, extract: vi.fn() } },
      { path: 'a/', file: { name: 'a.txt', size: 3, extract: vi.fn() } },
    ]);
    const handle = await openArchive(input());
    expect(handle.entries).toEqual([{ path: 'a/a.txt', size: 3 }, { path: 'z/b.txt', size: 2 }]);
    handle.close();
  });

  it('reports extraction failure with cause and leaves closure to the caller', async () => {
    const { extractA, close } = fixture();
    extractA.mockRejectedValueOnce(failure);
    const handle = await openArchive(input());
    const error = await errorOf(handle.extractOne('a/a.txt'));
    expect(error.code).toBe('unsupported');
    expect(error.cause).toBe(failure);
    expect(close).not.toHaveBeenCalled();
    handle.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects an absent path and leaves closure to the caller', async () => {
    const { close } = fixture();
    const handle = await openArchive(input());
    expect((await errorOf(handle.extractOne('missing'))).code).toBe('unsupported');
    expect(close).not.toHaveBeenCalled();
    handle.close();
  });

  it('extracts in listing order, reports each completion, and closes on success', async () => {
    const { extractA, extractB, close } = fixture();
    const handle = await openArchive(input());
    const progress = vi.fn();
    const result = await handle.extractAll(progress);
    expect(result.map((file) => file.name)).toEqual(['a.txt', 'b.txt']);
    expect(extractA.mock.invocationCallOrder[0]).toBeLessThan(extractB.mock.invocationCallOrder[0]);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('propagates progress callback errors unchanged and leaves closure to the caller', async () => {
    const { extractB, close } = fixture();
    const handle = await openArchive(input());
    await expect(handle.extractAll(() => { throw failure; })).rejects.toBe(failure);
    expect(extractB).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    handle.close();
  });

  it('leaves closure to the caller when extractAll fails', async () => {
    const { extractB, close } = fixture();
    extractB.mockRejectedValueOnce(failure);
    const handle = await openArchive(input());
    expect((await errorOf(handle.extractAll())).cause).toBe(failure);
    expect(close).not.toHaveBeenCalled();
    handle.close();
  });
});

it('initializes once with the published worker URL', async () => {
  const archive = fixture().archive;
  const init = vi.fn();
  const open = vi.fn(async () => archive);
  vi.doMock('libarchive.js', () => ({ Archive: { init, open } }));
  vi.resetModules();
  try {
    const { openArchive: openFresh } = await import('../../src/engine/archive/libarchive');
    const first = await openFresh(input());
    const second = await openFresh(input());
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith({ workerUrl: '/vendor/libarchive/worker-bundle.js' });
    expect(open).toHaveBeenCalledTimes(2);
    first.close();
    second.close();
  } finally {
    vi.doUnmock('libarchive.js');
    vi.resetModules();
  }
});
