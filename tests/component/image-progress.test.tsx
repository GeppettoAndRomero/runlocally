import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { ProgressPanel } from '../../src/app/image/ProgressPanel';
import { ImageConverter } from '../../src/app/image/ImageConverter';
import type { ImageStage } from '../../src/engine/image/convert';
import type { ImageResult } from '../../src/engine/image/types';
import { imageProgressContent } from '../../src/i18n/image-progress';
import { imageToolContent } from '../../src/i18n/image-tool';
vi.mock('../../src/ui/PwaStartup', () => ({ PwaStartup: () => null }));
vi.mock('../../src/app/registerSW', () => ({ isUpdateApplying: () => false, subscribeUpdate: () => () => {} }));
afterEach(cleanup);
function setup() {
  const calls: { stage?: (stage: ImageStage) => void; resolve: (value: ImageResult<Blob>) => void }[] = [];
  const terminate = vi.fn();
  const view = render(<ImageConverter locale="en" save={vi.fn()} clientFactory={() => ({ terminate,
    convert: (_input, _format, stage) => new Promise(resolve => calls.push({ stage, resolve })) })} />);
  const select = (...names: string[]) => fireEvent.change(view.container.querySelector('input[type=file]')!,
    { target: { files: names.map(name => new File(['x'], name)) } });
  const progress = () => view.container.querySelector('progress')!;
  return { ...view, select, calls, progress, terminate };
}
it.each(['ja', 'en'] as const)('renders localized counts and decorative stages outside live regions: %s', locale => {
  const t = imageProgressContent(locale);
  const view = render(<ProgressPanel locale={locale} done={1} total={3} current={{ name: '<photo>', stage: 'heic-decoder-preparing' }} />);
  expect(view.getByLabelText(t.label).getAttribute('value')).toBe('1');
  expect(view.container.textContent).toContain(t.count.replace('{done}', '1').replace('{total}', '3'));
  const text = view.getByText(`${t.processing}<photo> — ${t.stages['heic-decoder-preparing']}`);
  expect(text.closest('[aria-live], [role=status], ul, li')).toBeNull();
  expect(view.container.querySelector('[aria-valuenow], img')).toBeNull();
  expect(view.container.querySelector('.progress-panel__stages')?.getAttribute('aria-hidden')).toBe('true');
  const reached = () => view.container.querySelectorAll('.is-reached').length;
  expect(reached()).toBe(2);
  view.rerender(<ProgressPanel locale={locale} done={1} total={3} current={{ name: '<photo>', stage: 'decoding' }} />);
  expect(reached()).toBe(2);
  view.rerender(<ProgressPanel locale={locale} done={1} total={3} current={{ name: '<photo>', stage: 'encoding' }} />);
  expect(reached()).toBe(4); expect(view.container.textContent).not.toContain('%');
  view.rerender(<ProgressPanel locale={locale} done={0} total={0} />);
  expect(view.container.textContent).toBe('');
});
it('counts additions and failures, keeps the final active job and preserves the four log states', async () => {
  const s = setup(); const t = imageToolContent('en');
  s.select('first', 'second');
  expect(s.progress().max).toBe(2); expect(s.progress().value).toBe(0);
  expect(s.container.querySelector('ul')?.textContent).toContain(t.statuses.waiting);
  expect(s.container.querySelector('ul')?.textContent).toContain(t.statuses.converting);
  act(() => s.calls[0].stage?.('drawing'));
  const log = s.container.querySelector('ul')!.innerHTML;
  act(() => s.calls[0].stage?.('encoding'));
  expect(s.container.querySelector('ul')!.innerHTML).toBe(log);
  s.select('third'); expect(s.progress().max).toBe(3);
  await act(async () => s.calls[0].resolve({ ok: true, value: new Blob(['x']) }));
  await waitFor(() => expect(s.calls).toHaveLength(2));
  expect(s.progress().value).toBe(1); expect(s.container.textContent).not.toContain('Encoding');
  act(() => s.calls[0].stage?.('encoding')); expect(s.container.textContent).not.toContain('Encoding');
  await act(async () => s.calls[1].resolve({ ok: false, code: 'too-large' }));
  await waitFor(() => expect(s.calls).toHaveLength(3));
  expect(s.progress().value).toBe(2); expect(s.progress().max).toBe(3);
  act(() => s.calls[2].stage?.('decoding'));
  expect(s.container.textContent).toContain('Processing: third — Decoding');
  await act(async () => s.calls[2].resolve({ ok: true, value: new Blob(['x']) }));
  await waitFor(() => expect(s.container.querySelector('progress')).toBeNull());
  expect(s.container.querySelectorAll('li')).toHaveLength(3);
  expect(s.container.querySelector('ul')!.textContent).toContain(t.statuses.saved);
  expect(s.container.querySelector('ul')!.textContent).toContain(t.statuses.failed);
});
it('resets on departure and ignores old stages and finally handlers after a new generation starts', async () => {
  const s = setup(); s.select('old'); act(() => s.calls[0].stage?.('encoding'));
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  expect(s.container.querySelector('progress')).toBeNull(); expect(s.terminate).toHaveBeenCalledOnce();
  act(() => { window.dispatchEvent(new Event('pageshow')); }); s.select('new');
  act(() => s.calls[1].stage?.('reading'));
  await act(async () => { s.calls[0].stage?.('encoding'); s.calls[0].resolve({ ok: true, value: new Blob() }); });
  expect(s.progress().value).toBe(0); expect(s.progress().max).toBe(1);
  expect(s.container.textContent).toContain('Processing: new — Reading');
  s.unmount(); act(() => s.calls[1].stage?.('encoding'));
  expect(s.terminate).toHaveBeenCalledTimes(2);
});
