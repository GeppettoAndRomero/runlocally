import { useEffect, useRef, useState } from 'preact/hooks';
import type { Locale } from '../../i18n/locales';
import { imageToolContent } from '../../i18n/image-tool';
import { GlobalDropZone } from '../../ui/GlobalDropZone';
import { PwaStartup } from '../../ui/PwaStartup';
import { isUpdateApplying, subscribeUpdate } from '../registerSW';
import { downloadBlob } from '../download';
import { imageOutputName } from '../../engine/image/output';
import { sniffImageFormat } from '../../engine/image/sniff';
import type { ImageErrorCode, ImageOutputFormat } from '../../engine/image/types';
import { createImageClient, type ImageClient } from './client';
import { CapabilityList } from './CapabilityList';
import './image-converter.css';

type Log = { id: number; name: string; status: 'waiting' | 'converting' | 'saved' | 'failed'; code?: ImageErrorCode; avif?: boolean };
type Job = { id: number; file: File };
export function ImageConverter({ locale, clientFactory = createImageClient, save = downloadBlob }: {
  locale: Locale; clientFactory?: () => ImageClient; save?: typeof downloadBlob;
}) {
  const t = imageToolContent(locale);
  const [format, setFormat] = useState<ImageOutputFormat>('jpg');
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(isUpdateApplying);
  const state = useRef({ queue: [] as Job[], busy: false, hidden: false, mounted: false,
    applying: isUpdateApplying(), generation: 0, nextId: 0, format, client: undefined as ImageClient | undefined,
    names: new Set<string>() });
  const safe = () => !state.current.busy && state.current.queue.length === 0;
  const updateLog = (id: number, patch: Partial<Log>) => setLogs(previous => previous.map(log => log.id === id ? { ...log, ...patch } : log));
  function uniqueName(input: string): string {
    const names = state.current.names;
    const base = imageOutputName(input, state.current.format);
    const dot = base.lastIndexOf('.');
    let name = base;
    for (let index = 1; names.has(name); index++) name = `${base.slice(0, dot)}(${index})${base.slice(dot)}`;
    return name;
  }
  async function process(job: Job, generation: number): Promise<void> {
    const s = state.current;
    const current = () => s.mounted && !s.hidden && s.generation === generation;
    updateLog(job.id, { status: 'converting' });
    try {
      // A worker failure stops its client for good; later inputs need a fresh one.
      if (s.client?.stopped) s.client = undefined;
      s.client ??= clientFactory();
      const result = await s.client.convert(job.file, s.format);
      if (!current()) return;
      if (result.ok) {
        const name = uniqueName(job.file.name);
        save(result.value, name);
        s.names.add(name);
        updateLog(job.id, { status: 'saved' });
      } else {
        let avif = false;
        if (result.code === 'decode-failed') {
          try {
            let bytes = new Uint8Array(await job.file.slice(0, 65_536).arrayBuffer());
            let detected = sniffImageFormat(bytes);
            if (detected === 'unknown' && job.file.size > 65_536 && current()) {
              bytes = new Uint8Array(await job.file.arrayBuffer());
              detected = sniffImageFormat(bytes);
            }
            avif = detected === 'avif';
          } catch { /* Preserve the original decode error. */ }
        }
        if (current()) updateLog(job.id, { status: 'failed', code: result.code, avif });
      }
    } catch {
      if (current()) updateLog(job.id, { status: 'failed', code: 'encode-failed' });
    }
  }
  async function drain(generation: number): Promise<void> {
    const s = state.current;
    // Each awaited helper releases its input and output before the next job.
    while (s.queue.length && s.generation === generation) await process(s.queue.shift()!, generation);
    if (s.generation === generation) { s.busy = false; setBusy(false); }
  }
  function enqueue(files: File[]): void {
    const s = state.current;
    if (!s.mounted || s.hidden || s.applying || isUpdateApplying()) return;
    const jobs = files.map(file => ({ id: s.nextId++, file }));
    s.queue.push(...jobs);
    setLogs(previous => [...previous, ...jobs.map(({ id, file }) => ({ id, name: file.name, status: 'waiting' as const }))]);
    if (jobs.length && !s.busy) {
      s.busy = true; setBusy(true);
      void drain(s.generation);
    }
  }
  useEffect(() => {
    const s = state.current;
    s.mounted = true;
    const readiness = () => { window.__toolReady = s.mounted && !s.hidden && !s.applying; };
    const dropped = (event: Event) => {
      try {
        if (event instanceof CustomEvent && Array.isArray(event.detail) && event.detail.every(file => file instanceof File)) enqueue(event.detail);
      }
      finally { window.dispatchEvent(new CustomEvent('filesProcessed')); }
    };
    const stop = () => {
      s.hidden = true; s.generation++; s.queue.length = 0; s.busy = false;
      s.client?.terminate(); s.client = undefined;
      setBusy(false);
      setLogs(previous => previous.map(log => log.status === 'waiting' || log.status === 'converting'
        ? { ...log, status: 'failed', code: 'interrupted' } : log));
      readiness();
    };
    const resume = () => { s.hidden = false; readiness(); };
    window.addEventListener('filesDropped', dropped);
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', resume);
    const unsubscribe = subscribeUpdate(update => {
      s.applying = update.applying; setApplying(update.applying); readiness();
    });
    readiness();
    return () => {
      s.mounted = false; stop(); unsubscribe();
      window.removeEventListener('filesDropped', dropped);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('pageshow', resume);
    };
  }, []);
  return <section class="image-converter">
    <CapabilityList locale={locale} />
    <fieldset disabled={busy || applying}>
      <legend>{t.labels.outputFormat}</legend>
      {(['jpg', 'png'] as const).map(value => <label key={value}>
        <input type="radio" name="image-output-format" value={value} checked={format === value}
          onChange={() => { if (safe() && !isUpdateApplying()) { state.current.format = value; setFormat(value); } }} />{t.formats[value]}
      </label>)}
    </fieldset>
    <label>{t.labels.selectImages}<input type="file" multiple accept="image/*,.heic,.heif,.avif" disabled={applying}
      onChange={event => { const input = event.currentTarget; enqueue(Array.from(input.files ?? [])); input.value = ''; }} /></label>
    <p>{t.input.dropZone}</p>
    <GlobalDropZone locale={locale} disabled={applying} />
    <ul aria-live="polite">{logs.map(log => <li key={log.id}>
      <span>{log.name}</span> — {t.statuses[log.status]}
      {log.code && <span> — {t.errors[log.code]}</span>}
      {log.avif && <p>{t.notices.avif}</p>}
    </li>)}</ul>
    {(['metadata', 'onDevice', 'chrome', 'safari', 'heic'] as const).map(key => <p key={key}>{t.notices[key]}</p>)}
    <PwaStartup locale={locale} busy={busy} hasWork={state.current.queue.length > 0} isSafe={safe} />
  </section>;
}
