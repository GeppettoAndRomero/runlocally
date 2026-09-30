import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { LOCALES, type Locale } from '../i18n/locales';
import { AVAILABLE_OPS, type AvailableOpId } from '../i18n/ops';
import { pagePath, zipPageFromPath } from '../seo/page';
import type { ZipPage } from '../seo/url-model';
import { displayPage } from './page-display';
import { AppButton } from '../ui/AppButton';
import { AppCard } from '../ui/AppCard';
import { PwaStartup } from '../ui/PwaStartup';
import { isUpdateApplying, subscribeUpdate } from './registerSW';
import { GlobalDropZone } from '../ui/GlobalDropZone';
import { Alert, Status } from '../ui/WorkbenchFeedback';
import { inputStateCopy } from '../ui/input-state-copy';
import { downloadBlob } from './download';
import { initialSession, sessionReducer } from './state/reducer';
import { directoryState, keptFileCount } from './state/reducer';
import type { OpId, Session } from './state/session';
import { WorkbenchController } from './workbench-controller';
import { ui, updateUi } from '../i18n/ui';
import { failureText } from './workbench-errors';
import { repairPlan } from './rewrite-plan';
import './workbench.css';

const PAGE_SIZE = 500;
function leafName(path: string): string { return path.split('/').filter(Boolean).at(-1) || 'file'; }
function EntryIcon({ directory }: { directory: boolean }) {
  return directory
    ? <svg class="workbench__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 6.5h7l2 2h10v10h-19z" stroke-linejoin="round" /></svg>
    : <svg class="workbench__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 2.5h9l5 5v14H5zM14 2.5v5h5" stroke-linejoin="round" /></svg>;
}
export function isWorkbenchBusy(session: Session, controller: WorkbenchController | null): boolean {
  return Boolean(controller?.processing) || session.listing.status === 'reading' || session.job.status === 'running';
}
export function isWorkbenchUpdateSafe(session: Session, controller: WorkbenchController | null): boolean {
  return !isWorkbenchBusy(session, controller) && !session.source && session.results.length === 0;
}
export function Workbench({ locale, page: initialPage = 'top', op = 'browse' }: { locale: Locale; page?: ZipPage; op?: AvailableOpId }) {
  const [route, setRoute] = useState<{ locale: Locale; page: ZipPage }>({ locale, page: initialPage });
  const routeRef = useRef(route);
  routeRef.current = route;
  const [session, publish] = useReducer(sessionReducer, undefined, () => initialSession(0, op));
  const [updating, setUpdating] = useState(false);
  useEffect(() => subscribeUpdate(state => setUpdating(state.applying)), []);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const pageHiddenRef = useRef(false);
  useEffect(() => { window.__toolReady = !updating && !pageHiddenRef.current; }, [updating]);
  const controllerRef = useRef<WorkbenchController | null>(null);
  const [controllerBusy, setControllerBusy] = useState(false);
  if (!controllerRef.current) controllerRef.current = new WorkbenchController(publish, setControllerBusy);
  const [page, setPage] = useState(0);
  const [removePage, setRemovePage] = useState(0);
  const [repairPage, setRepairPage] = useState(0);
  const t = ui[route.locale].workbench;
  const copy = inputStateCopy[route.locale];
  const requestedOp = (value: ZipPage): AvailableOpId => value === 'top' ? 'browse' : value;
  const navigate = (next: { locale: Locale; page: ZipPage }, mode: 'push' | 'replace' | 'pop' = 'push') => {
    const current = routeRef.current;
    const path = pagePath(next.locale, next.page);
    if (mode === 'push' && current.locale === next.locale && current.page === next.page) return;
    if (mode === 'push') window.history.pushState(null, '', path);
    if (mode === 'replace') window.history.replaceState(null, '', path);
    routeRef.current = next;
    setRoute(next);
    publish({ type: 'op/select', op: requestedOp(next.page) });
  };
  const selectOp = (next: AvailableOpId) => navigate({ locale: routeRef.current.locale, page: next });
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[data-chrome-home], a[data-chrome-page], a[data-chrome-locale]');
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || url.search || url.hash) return;
      const next = zipPageFromPath(url.pathname);
      if (!next) return;
      event.preventDefault();
      navigate(next);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, []);
  useEffect(() => {
    const pop = () => {
      const next = zipPageFromPath(window.location.pathname);
      if (next) navigate(next, 'pop');
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => { displayPage(route.locale, route.page); }, [route]);
  useEffect(() => {
    if (session.source?.kind && session.source.kind !== 'zip' && route.page !== 'top' &&
        !AVAILABLE_OPS.find(entry => entry.id === route.page)?.archive) {
      navigate({ locale: route.locale, page: 'browse' }, 'replace');
    } else if (!session.source && session.op !== requestedOp(route.page)) {
      publish({ type: 'op/select', op: requestedOp(route.page) });
    }
  }, [session.source, session.op, route]);
  useEffect(() => {
    if (session.source) document.documentElement.dataset.session = 'open';
    else delete document.documentElement.dataset.session;
  }, [session.source]);
  useEffect(() => () => { delete document.documentElement.dataset.session; }, []);
  useEffect(() => { setPage(0); setRemovePage(0); setRepairPage(0); }, [session.generation]);
  useEffect(() => {
    const dropped = (event: Event) => {
      if (isUpdateApplying()) { window.dispatchEvent(new Event('filesProcessed')); return; }
      void controllerRef.current?.accept((event as CustomEvent<File[]>).detail, session).finally(() => window.dispatchEvent(new Event('filesProcessed')));
    };
    const stopIntake = () => { window.__toolReady = false; window.removeEventListener('filesDropped', dropped); };
    const startIntake = () => {
      if (pageHiddenRef.current) return;
      window.addEventListener('filesDropped', dropped);
      window.__toolReady = !isUpdateApplying();
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
      if (event.persisted) controllerRef.current = new WorkbenchController(publish, setControllerBusy);
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
  const entries = zip ? session.entries.map((entry) => ({ name: entry.name, size: entry.size, directory: entry.directory,
    eligible: !entry.directory && !entry.encrypted })) : session.archiveEntries.map(entry => ({ name: entry.path, size: entry.size, eligible: true }));
  const fileCount = zip ? session.entries.filter(entry => !entry.directory).length : entries.length;
  const eligible = entries.filter(entry => entry.eligible).length;
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visible = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const duplicates = zip && new Set(session.entries.map(entry => entry.name)).size !== session.entries.length;
  const operations: OpId[] = AVAILABLE_OPS.filter(entry => zip || entry.archive).map(entry => entry.id);
  const removed = zip ? session.entries.filter(entry => !session.selection.has(entry.name)).length : 0;
  const keptFiles = zip ? keptFileCount(session.entries, session.selection) : 0;
  const repair = repairPlan(zip ? session.entries : []);
  const hasCandidates = zip && repair.changes.length > 0;
  const encryptedKept = zip && session.entries.some(entry => entry.encrypted && session.selection.has(entry.name));
  const extractInput = session.inputs.extract;
  const currentOne = extractInput.mode === 'one' && entries.some(entry => entry.name === extractInput.name && entry.eligible);
  const failure = session.inputFailure;
  const inputError = failure && failureText(failure, t, 'input');
  const busy = controllerBusy || isWorkbenchBusy(session, controllerRef.current);
  const isSafeToUpdate = () => isWorkbenchUpdateSafe(sessionRef.current, controllerRef.current);
  const results = session.results;
  const canReset = busy || Boolean(session.source || session.inputFailure || results.length || session.listing.status !== 'idle' || session.job.status !== 'idle');
  return <div class="workbench">
    <PwaStartup locale={route.locale} busy={busy} hasWork={Boolean(session.source || results.length)} isSafe={isSafeToUpdate} />
    <GlobalDropZone locale={route.locale} disabled={updating} />
    {updating && <Status>{updateUi[route.locale].applying}</Status>}
    <label class="workbench__language">{ui[route.locale].shared.language} <select aria-label={ui[route.locale].shared.language} value={route.locale} onChange={event => {
      const next = LOCALES.find(entry => entry.code === event.currentTarget.value);
      if (next) navigate({ locale: next.code, page: routeRef.current.page });
    }}>{LOCALES.map(entry => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></label>
    <AppCard title={t.input} className="workbench__input-card">
      <label class="workbench__picker"><span>{t.choose}</span><span id="workbench-drop-hint" class="workbench__hint">{copy.dropHint}</span><input type="file" aria-label={t.choose} aria-describedby="workbench-drop-hint" disabled={busy || updating} onChange={event => {
        const input = event.currentTarget;
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (files.length && !isUpdateApplying()) void controllerRef.current?.accept(files, session);
      }} /></label>
      {session.source && <p class="workbench__source">{t.source}: <span class="workbench__filename">{session.source.file.name}</span> <span class="workbench__kind">({session.source.kind})</span></p>}
      {session.source?.kind === 'unknown' && <Alert>{t.unknown}</Alert>}
      {inputError && <Alert>{inputError}</Alert>}
      {canReset && <AppButton variant="secondary" ariaLabel={`${t.reset}: ${session.source?.file.name ?? t.input}`} onClick={() => controllerRef.current?.reset()}>{t.reset}</AppButton>}
    </AppCard>
    {session.listing.status === 'reading' && <Status spinning>{t.busy}</Status>}
    {session.listing.status === 'error' && <div><Alert>{failureText(session.listing.failure, t, 'listing')} {session.source?.kind === 'zip' ? t.listingZip : session.source?.kind === 'rar' || session.source?.kind === '7z' ? t.listingArchive : session.source?.kind === 'tar' ? t.listingTar : t.listingUnknown}</Alert>
      <AppButton variant="secondary" ariaLabel={`${t.retryListing}: ${session.source?.file.name}`} disabled={busy} onClick={() => void controllerRef.current?.retryListing(session)}>{t.retryListing}</AppButton></div>}
    {ready && <>
      <div class="workbench__tabs" role="tablist" aria-label={t.source} onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const current = operations.indexOf(session.op);
          const op = operations[(current + (event.key === 'ArrowRight' ? 1 : operations.length - 1)) % operations.length];
          selectOp(op);
          (event.currentTarget.querySelector(`[data-op="${op}"]`) as HTMLButtonElement | null)?.focus();
        }
      }}>
        {operations.map(op => <button key={op} data-op={op} id={`tab-${op}`} type="button" role="tab"
          aria-selected={session.op === op} aria-controls={`panel-${op}`} tabIndex={session.op === op ? 0 : -1}
          onClick={() => selectOp(op)}>{t[op]}</button>)}
      </div>
      <section id="panel-browse" role="tabpanel" aria-labelledby="tab-browse" hidden={session.op !== 'browse'}>
        <AppCard title={t.browse}>
          <p>{t.entries}: {entries.length} / {t.files}: {fileCount} / {t.eligible}: {eligible}</p>
          {duplicates && <p>{t.duplicate}</p>}
          <div class="workbench__list" role="list">{visible.map((entry, index) => <div role="listitem" class="workbench__row" key={`${page}-${index}`}>
            <span class="workbench__entry"><EntryIcon directory={'directory' in entry && entry.directory === true} /><span class="workbench__name">{entry.name}</span></span><span class="workbench__size">{entry.size} B</span>
            {entry.eligible && <AppButton variant="ghost" ariaLabel={`${t.chooseOne}: ${entry.name}`} onClick={() => {
              publish({ type: 'op/input', op: 'extract', input: { mode: 'one', name: entry.name } });
              selectOp('extract');
              document.getElementById('tab-extract')?.focus();
            }}>{t.chooseOne}</AppButton>}
          </div>)}</div>
          <nav class="workbench__pages" aria-label={t.page}>
            <AppButton variant="secondary" ariaLabel={`${t.previous}: ${t.browse} ${t.page}`} disabled={page === 0} onClick={() => setPage(page - 1)}>{t.previous}</AppButton>
            <span>{t.page} {page + 1} / {pages}</span>
            <AppButton variant="secondary" ariaLabel={`${t.next}: ${t.browse} ${t.page}`} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t.next}</AppButton>
          </nav>
        </AppCard>
      </section>
      <section id="panel-extract" role="tabpanel" aria-labelledby="tab-extract" hidden={session.op !== 'extract'}>
        <AppCard title={t.extract}>
          <label class="workbench__choice"><input type="radio" name="extract-mode" checked={extractInput.mode === 'all'} onChange={() => publish({ type: 'op/input', op: 'extract', input: { mode: 'all' } })} />{t.all} ({eligible})</label>
          <label class="workbench__choice"><input type="radio" name="extract-mode" checked={extractInput.mode === 'one'} onChange={() => {
            const first = entries.find(entry => entry.eligible);
            if (first) publish({ type: 'op/input', op: 'extract', input: { mode: 'one', name: first.name } });
          }} />{t.one}</label>
          {extractInput.mode === 'one' && <select aria-label={t.one} value={extractInput.name} onChange={event => publish({ type: 'op/input', op: 'extract', input: { mode: 'one', name: event.currentTarget.value } })}>
            {entries.filter(entry => entry.eligible).map((entry, index) => <option key={index} value={entry.name}>{entry.name}</option>)}
          </select>}
          {zip && <p>{t.encrypted}</p>}
          <AppButton ariaLabel={`${t.run}: ${extractInput.mode === 'one' ? extractInput.name : session.source?.file.name}`} disabled={busy || updating || (extractInput.mode === 'one' && !currentOne)} onClick={() => { if (!isUpdateApplying()) void controllerRef.current?.run(session); }}>{t.run}</AppButton>
        </AppCard>
      </section>
      {zip && <section id="panel-remove" role="tabpanel" aria-labelledby="tab-remove" hidden={session.op !== 'remove'}>
        <AppCard title={t.remove}>
          <p>{t.removeGuide}</p>
          {duplicates && <p>{t.duplicateKeep}</p>}
          {hasCandidates && <p>{t.orderGuide} <AppButton variant="ghost" ariaLabel={`${t.goRepair}: ${session.source?.file.name}`} onClick={() => { selectOp('fix-names'); document.getElementById('tab-fix-names')?.focus(); }}>{t.goRepair}</AppButton></p>}
          <p>{t.plannedRemove}: {removed}{t.entriesUnit} / {t.keptFiles}: {keptFiles}{t.filesUnit}</p>
          {encryptedKept && <p>{t.encryptedKept}</p>}
          <div class="workbench__actions"><AppButton variant="secondary" ariaLabel={`${t.keepAll}: ${session.source?.file.name}`} disabled={busy} onClick={() => publish({ type: 'selection/all', keep: true })}>{t.keepAll}</AppButton>
            <AppButton variant="secondary" ariaLabel={`${t.clearAll}: ${session.source?.file.name}`} disabled={busy} onClick={() => publish({ type: 'selection/all', keep: false })}>{t.clearAll}</AppButton></div>
          <div class="workbench__list" role="list" aria-label={t.remove}>{session.entries.slice(removePage * PAGE_SIZE, (removePage + 1) * PAGE_SIZE).map((entry, index) => {
            const state = entry.directory ? directoryState(session.entries, entry.name, session.selection) : session.selection.has(entry.name) ? 'checked' : 'unchecked';
            return <div role="listitem" class="workbench__row workbench__remove-row" data-keep-state={state} key={`${removePage}-${index}`}><label class="workbench__choice"><input type="checkbox" checked={state === 'checked'}
              ref={node => { if (node) node.indeterminate = state === 'indeterminate'; }} disabled={busy}
              aria-label={`${entry.name}: ${t.keep}`} onChange={event => publish({ type: 'selection/toggle', name: entry.name, keep: event.currentTarget.checked })} /><EntryIcon directory={entry.directory} /><span class="workbench__name">{entry.name}</span></label></div>;
          })}</div>
          <nav class="workbench__pages" aria-label={`${t.remove} ${t.page}`}><AppButton variant="secondary" ariaLabel={`${t.previous}: ${t.remove} ${t.page}`} disabled={removePage === 0} onClick={() => setRemovePage(removePage - 1)}>{t.previous}</AppButton>
            <span>{t.page} {removePage + 1} / {Math.max(1, Math.ceil(session.entries.length / PAGE_SIZE))}</span>
            <AppButton variant="secondary" ariaLabel={`${t.next}: ${t.remove} ${t.page}`} disabled={(removePage + 1) * PAGE_SIZE >= session.entries.length} onClick={() => setRemovePage(removePage + 1)}>{t.next}</AppButton></nav>
          {keptFiles === 0 && <p>{t.emptyKeep}</p>}
          <AppButton ariaLabel={`${t.removeRun}: ${session.source?.file.name}`} disabled={busy || updating || removed === 0 || keptFiles === 0} onClick={() => { if (!isUpdateApplying()) void controllerRef.current?.run(session); }}>{t.removeRun}</AppButton>
        </AppCard>
      </section>}
      {zip && <section id="panel-fix-names" role="tabpanel" aria-labelledby="tab-fix-names" hidden={session.op !== 'fix-names'}>
        <AppCard title={t['fix-names']}>
          <p>{t.repairGuide}</p><p>{t.plannedRepair}: {repair.changes.length}{t.entriesUnit}</p>
          {repair.collision && <Alert>{t.collision}{repair.collision}</Alert>}
          <div class="workbench__list" role="list" aria-label={t['fix-names']}>{repair.changes.slice(repairPage * PAGE_SIZE, (repairPage + 1) * PAGE_SIZE).map((change, index) =>
            <div role="listitem" class="workbench__row workbench__repair-row" key={`${repairPage}-${index}`}><span class="workbench__name">{t.repairBefore}: {change.before}</span><span class="workbench__name">{t.repairAfter}: {change.after}</span></div>)}</div>
          <nav class="workbench__pages" aria-label={`${t['fix-names']} ${t.page}`}><AppButton variant="secondary" ariaLabel={`${t.previous}: ${t['fix-names']} ${t.page}`} disabled={repairPage === 0} onClick={() => setRepairPage(repairPage - 1)}>{t.previous}</AppButton>
            <span>{t.page} {repairPage + 1} / {Math.max(1, Math.ceil(repair.changes.length / PAGE_SIZE))}</span>
            <AppButton variant="secondary" ariaLabel={`${t.next}: ${t['fix-names']} ${t.page}`} disabled={(repairPage + 1) * PAGE_SIZE >= repair.changes.length} onClick={() => setRepairPage(repairPage + 1)}>{t.next}</AppButton></nav>
          <AppButton ariaLabel={`${t.repairRun}: ${session.source?.file.name}`} disabled={busy || updating || repair.changes.length === 0 || Boolean(repair.collision)} onClick={() => { if (!isUpdateApplying()) void controllerRef.current?.run(session); }}>{t.repairRun}</AppButton>
        </AppCard>
      </section>}
      {session.job.status === 'running' && session.job.progress?.kind === 'extract' && <Status progress={{ done: session.job.progress.done, total: session.job.progress.total }} label={copy.progressLabel}>{t.progress}: {session.job.progress.done} / {session.job.progress.total}</Status>}
      {session.job.status === 'running' && session.job.progress?.kind === 'rewrite' && <Status spinning>{t.processingEntry}: {session.job.progress.progress.index + 1} / {session.job.progress.progress.total} {session.job.progress.progress.name}</Status>}
      {session.job.status === 'failed' && <Alert>{t[session.job.op]}: {failureText(session.job.failure, t, 'job', session.job.op)}</Alert>}
    </>}
    <AppCard title={t.results}>
      {results.length === 0 && <p class="workbench__empty">{copy.emptyResults}</p>}
      {results.map(result => <article class="workbench__result" key={result.id}>
        <h3>{t[result.op]}</h3>
        <p class="workbench__result-source">{t.source}: {result.sourceFile.name}</p>
        <p class="workbench__result-summary">{result.actual.kind === 'extract' ? `${result.actual.files}${t.count}` : result.op === 'remove' ?
          `${t.removed} ${result.actual.counts.removed}${t.entriesUnit} / ${t.kept} ${result.actual.counts.kept}${t.entriesUnit}` :
          `${t.repaired} ${result.actual.counts.renamed}${t.entriesUnit}`}</p>
        {result.files.map((file, index) => <div class="workbench__row" key={index}>
          <span class="workbench__name">{file.name}</span>
          <span class="workbench__row-actions"><AppButton variant="secondary" ariaLabel={`${t.saveFile}: ${file.name}`} onClick={() => downloadBlob(file.blob, result.op === 'extract' ? leafName(file.name) : file.name)}>{t.save}</AppButton>
          <AppButton variant="ghost" ariaLabel={`${t.reinputFile}: ${file.name}`} disabled={busy} onClick={() => void controllerRef.current?.accept([new File([file.blob], result.op === 'extract' ? leafName(file.name) : file.name)], session, result.id)}>{t.reinput}</AppButton></span>
        </div>)}
      </article>)}
    </AppCard>
  </div>;
}
