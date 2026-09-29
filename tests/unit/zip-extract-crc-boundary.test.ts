import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZipReader, ERR_INVALID_CRC32, configure, type FileEntry } from '@zip.js/zip.js';
import { extractAll, extractEntry } from '../../src/engine/zip/extract';
import { readCentralEntries } from '../../src/engine/zip/list';

vi.mock('../../src/engine/zip/list', () => ({ readCentralEntries: vi.fn() }));
configure({ useWebWorkers: false });
afterEach(() => vi.restoreAllMocks());

const input = () => new File(['unused'], 'input.zip');
function entry(name: string, getData: () => Promise<Blob>): FileEntry {
  return { filename: name, directory: false, encrypted: false, getData } as unknown as FileEntry;
}

function arrange(entries: FileEntry[]) {
  vi.mocked(readCentralEntries).mockResolvedValue(entries);
  const close = vi.spyOn(ZipReader.prototype, 'close').mockResolvedValue(undefined);
  return close;
}

describe('extraction error boundary', () => {
  it('uses signature verification and closes the reader for a CRC error', async () => {
    const getData = vi.fn(async () => { throw new Error(ERR_INVALID_CRC32); });
    const close = arrange([entry('broken.txt', getData)]);
    await expect(extractEntry(input(), 'broken.txt')).rejects.toMatchObject({ code: 'corrupt-entry' });
    expect(getData).toHaveBeenCalledWith(expect.anything(), { checkSignature: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not convert unrelated getData errors', async () => {
    const failure = new Error('inflate failed');
    const close = arrange([entry('other.txt', async () => { throw failure; })]);
    await expect(extractEntry(input(), 'other.txt')).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not convert a progress callback error or count a failed file', async () => {
    const failure = new Error('progress failed');
    const close = arrange([entry('ok.txt', async () => new Blob(['ok']))]);
    await expect(extractAll(input(), () => { throw failure; })).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
    const progress: number[] = [];
    arrange([
      entry('ok.txt', async () => new Blob(['ok'])),
      entry('broken.txt', async () => { throw new Error(ERR_INVALID_CRC32); }),
    ]);
    await expect(extractAll(input(), done => { progress.push(done); })).rejects.toMatchObject({ code: 'corrupt-entry' });
    expect(progress).toEqual([1]);
  });
});
