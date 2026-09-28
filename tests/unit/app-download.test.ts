import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '../../src/app/download';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadBlob', () => {
  function setup(failClick = false) {
    const remove = vi.fn();
    const click = vi.fn(() => { if (failClick) throw new Error('click failed'); });
    const anchor = { href: '', download: '', click, remove };
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { anchor, appendChild, click, remove, createObjectURL, revokeObjectURL };
  }
  it('clicks with the exact name, removes the anchor and revokes later', () => {
    vi.useFakeTimers();
    const ui = setup();
    const blob = new Blob(['content']);
    downloadBlob(blob, 'original.txt');
    expect(ui.createObjectURL).toHaveBeenCalledWith(blob);
    expect(ui.anchor.href).toBe('blob:test');
    expect(ui.anchor.download).toBe('original.txt');
    expect(ui.appendChild).toHaveBeenCalledWith(ui.anchor);
    expect(ui.click).toHaveBeenCalledOnce();
    expect(ui.remove).toHaveBeenCalledOnce();
    expect(ui.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(ui.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
  it('removes and revokes immediately when clicking fails', () => {
    const ui = setup(true);
    expect(() => downloadBlob(new Blob(), 'failed.txt')).toThrow('click failed');
    expect(ui.remove).toHaveBeenCalledOnce();
    expect(ui.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
