import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { Locale } from '../i18n/locales';
import { AppButton } from '../ui/AppButton';
import { AppCard } from '../ui/AppCard';
import { GlobalDropZone } from '../ui/GlobalDropZone';
import { downloadBlob } from './download';
import { initialSession, sessionReducer } from './state/reducer';
import type { ResultRecord } from './state/session';
import { WorkbenchController } from './workbench-controller';
import { workbenchStrings } from './workbench-strings';
import './workbench.css';

const PAGE_SIZE = 500;
function leafName(path: string): string { return path.split('/').filter(Boolean).at(-1) || 'file'; }
function savedName(result: ResultRecord, name: string): string {
  if (result.op === 'remove') return `${result.sourceFile.name.replace(/\.zip$/i, '')}-trimmed.zip`;
  if (result.op === 'fix-names') return `${result.sourceFile.name.replace(/\.zip$/i, '')}-fixed.zip`;
  return leafName(name);
}

export function Workbench({ locale }: { locale: Locale }) {
  const [session, publish] = useReducer(sessionReducer, undefined, () => initialSession());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const pageHiddenRef = useRef(false);
  const controllerRef = useRef<WorkbenchController | null>(null);
  if (!controllerRef.current) controllerRef.current = new WorkbenchController(publish);
  const [page, setPage] = useState(0);
  const t = workbenchStrings[locale];
  useEffect(() => { setPage(0); }, [session.generation]);
  useEffect(() => {
    const dropped = (event: Event) => {
      void controllerRef.current?.accept((event as CustomEvent<File[]>).detail, session).finally(() => window.dispatchEvent(new Event('filesProcessed')));
    };
    const stopIntake = () => { window.__toolReady = false; window.removeEventListener('filesDropped', dropped); };
    const startIntake = () => {
      if (pageHiddenRef.current) return;
      window.addEventListener('filesDropped', dropped);
      window.__toolReady = true;
    };
    const hideIntake = () => { pageHiddenRef.current = true; stopIntake(); };
    const resumeIntake = (event: PageTransitionEvent) => {
      if (event.persisted) { pageHiddenRef.current = false; startIntake(); }
    };
    startIntake();
    window.addEventListener('pagehide', hideIntake);
    window.addEventListener('pageshow', resumeIntake);
    return () => { stopIntake(); window.removeEventListener('pagehide', hideIntake); window.removeEventListener('pageshow', resumeIntake); };
  }, [session]);
  useEffect(() => {
    const leave = () => {
      window.__toolReady = false;
      controllerRef.current?.dispose();
      const current = sessionRef.current;
      if (current.listing.status === 'reading') publish({ type: 'listing/failure', generation: current.generation,
        requestId: current.listing.requestId, error: new DOMException('Page hidden', 'AbortError') });
      if (current.job.status === 'running') publish({ type: 'job/failure', generation: current.generation,
        id: current.job.id, error: new DOMException('Page hidden', 'AbortError') });
    };
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) controllerRef.current = new WorkbenchController(publish);
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);
    return () => {
      window.__toolReady = false;
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resume);
      controllerRef.current?.dispose();
    };
  }, []);
  const ready = session.listing.status === 'ready';
  const zip = session.listing.status === 'ready' && session.listing.route === 'zip';
  const entries = zip ? session.entries.map((entry) => ({ name: entry.name, size: entry.size,
    eligible: !entry.directory && !entry.encrypted })) : session.archiveEntries.map(entry => ({ name: entry.path, size: entry.size, eligible: true }));
  const fileCount = zip ? session.entries.filter(entry => !entry.directory).length : entries.length;
  const eligible = entries.filter(entry => entry.eligible).length;
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visible = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const duplicates = zip && new Set(session.entries.map(entry => entry.name)).size !== session.entries.length;
  const extractInput = session.inputs.extract;
  const currentOne = extractInput.mode === 'one' && entries.some(entry => entry.name === extractInput.name && entry.eligible);
  const failure = session.inputFailure;
  const failureText = failure?.kind === 'engine' && failure.code === 'too-large' ? t.large :
    failure?.message === 'single-file' ? t.single : failure?.message === 'busy' ? t.busy : failure?.message;
  const busy = session.listing.status === 'reading' || session.job.status === 'running';
  const results = session.results;
  return <div class="workbench">
    <GlobalDropZone locale={locale} />
    <AppCard title={t.input}>
      <label class="workbench__picker">{t.choose}<input type="file" aria-label={t.choose} disabled={busy} onChange={event => {
        const input = event.currentTarget;
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (files.length) void controllerRef.current?.accept(files, session);
      }} /></label>
      {session.source && <p>{t.source}: <span>{session.source.file.name}</span> ({session.source.kind})</p>}
      {session.source?.kind === 'unknown' && <p role="alert">{t.unknown}</p>}
      {failureText && <p role="alert">{failureText}</p>}
      <AppButton variant="secondary" onClick={() => controllerRef.current?.reset()}>{t.reset}</AppButton>
    </AppCard>
    {session.listing.status === 'reading' && <p role="status">{t.busy}</p>}
    {session.listing.status === 'error' && <p role="alert">{t.listingError} {session.listing.failure.message}</p>}
    {ready && <>
      <div class="workbench__tabs" role="tablist" aria-label={t.source} onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const op = session.op === 'browse' ? 'extract' : 'browse';
          publish({ type: 'op/select', op });
          (event.currentTarget.querySelector(`[data-op="${op}"]`) as HTMLButtonElement | null)?.focus();
        }
      }}>
        {(['browse', 'extract'] as const).map(op => <button key={op} data-op={op} id={`tab-${op}`} type="button" role="tab"
          aria-selected={session.op === op} aria-controls={`panel-${op}`} tabIndex={session.op === op ? 0 : -1}
          onClick={() => publish({ type: 'op/select', op })}>{t[op]}</button>)}
      </div>
      <section id="panel-browse" role="tabpanel" aria-labelledby="tab-browse" hidden={session.op !== 'browse'}>
        <AppCard title={t.browse}>
          <p>{t.entries}: {entries.length} / {t.files}: {fileCount} / {t.eligible}: {eligible}</p>
          {duplicates && <p>{t.duplicate}</p>}
          <div class="workbench__list" role="list">{visible.map((entry, index) => <div role="listitem" class="workbench__row" key={`${page}-${index}`}>
            <span>{entry.name}</span><span>{entry.size} B</span>
            {entry.eligible && <AppButton variant="ghost" onClick={() => {
              publish({ type: 'op/input', op: 'extract', input: { mode: 'one', name: entry.name } });
              publish({ type: 'op/select', op: 'extract' });
              document.getElementById('tab-extract')?.focus();
            }}>{t.chooseOne}</AppButton>}
          </div>)}</div>
          <nav class="workbench__pages" aria-label={t.page}>
            <AppButton variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>{t.previous}</AppButton>
            <span>{t.page} {page + 1} / {pages}</span>
            <AppButton variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t.next}</AppButton>
          </nav>
        </AppCard>
      </section>
      <section id="panel-extract" role="tabpanel" aria-labelledby="tab-extract" hidden={session.op !== 'extract'}>
        <AppCard title={t.extract}>
          <label><input type="radio" name="extract-mode" checked={extractInput.mode === 'all'} onChange={() => publish({ type: 'op/input', op: 'extract', input: { mode: 'all' } })} />{t.all} ({eligible})</label>
          <label><input type="radio" name="extract-mode" checked={extractInput.mode === 'one'} onChange={() => {
            const first = entries.find(entry => entry.eligible);
            if (first) publish({ type: 'op/input', op: 'extract', input: { mode: 'one', name: first.name } });
          }} />{t.one}</label>
          {extractInput.mode === 'one' && <select aria-label={t.one} value={extractInput.name} onChange={event => publish({ type: 'op/input', op: 'extract', input: { mode: 'one', name: event.currentTarget.value } })}>
            {entries.filter(entry => entry.eligible).map((entry, index) => <option key={index} value={entry.name}>{entry.name}</option>)}
          </select>}
          {zip && <p>{t.encrypted}</p>}
          <AppButton disabled={busy || (extractInput.mode === 'one' && !currentOne)} onClick={() => void controllerRef.current?.run(session)}>{t.run}</AppButton>
          {session.job.status === 'running' && session.job.progress?.kind === 'extract' && <p role="status">{t.progress}: {session.job.progress.done} / {session.job.progress.total}</p>}
          {session.job.status === 'failed' && <p role="alert">{t.jobError} {session.job.failure.message}</p>}
        </AppCard>
      </section>
    </>}
    <AppCard title={t.results}>
      {results.map(result => <article class="workbench__result" key={result.id}>
        <h4>{result.op === 'extract' ? t.extract : result.op}</h4>
        <p>{t.source}: {result.sourceFile.name}</p>
        <p>{result.actual.kind === 'extract' ? result.actual.files : result.files.length}{t.count}</p>
        {result.files.map((file, index) => <div class="workbench__row" key={index}>
          <span>{file.name}</span>
          <AppButton variant="secondary" ariaLabel={`${t.saveFile}: ${file.name}`} onClick={() => downloadBlob(file.blob, savedName(result, file.name))}>{t.save}</AppButton>
          <AppButton variant="ghost" ariaLabel={`${t.reinputFile}: ${file.name}`} disabled={busy} onClick={() => void controllerRef.current?.accept([new File([file.blob], leafName(file.name))], session, result.id)}>{t.reinput}</AppButton>
        </div>)}
      </article>)}
    </AppCard>
  </div>;
}
