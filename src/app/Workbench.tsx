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
import type { Session } from './state/session';
import { WorkbenchController } from './workbench-controller';
import { ui, updateUi } from '../i18n/ui';
import { failureText } from './workbench-errors';
import { panelRegistry } from './panels';
import { OperationMenu } from './OperationMenu';
import './workbench.css';

function leafName(path: string): string { return path.split('/').filter(Boolean).at(-1) || 'file'; }
export function isWorkbenchBusy(session: Session, controller: WorkbenchController | null): boolean {
  return Boolean(controller?.processing) || session.listing.status === 'reading' || session.job.status === 'running';
}
export function isWorkbenchUpdateSafe(session: Session, controller: WorkbenchController | null, createSelectionCount = 0): boolean {
  return createSelectionCount === 0 && !isWorkbenchBusy(session, controller) && !session.source && session.results.length === 0 &&
    session.create.input.length === 0 && !session.create.result && session.create.run.status !== 'running';
}
export function Workbench({ locale, page: initialPage = 'top', op = 'browse' }: { locale: Locale; page?: ZipPage; op?: AvailableOpId }) {
  const [route, setRoute] = useState<{ locale: Locale; page: ZipPage }>({ locale, page: initialPage });
  const routeRef = useRef(route);
  routeRef.current = route;
  const [session, publish] = useReducer(sessionReducer, undefined, () => initialSession(0, op));
  const [createSelectionCount, setCreateSelectionCount] = useState(0);
  const createSelectionCountRef = useRef(0);
  const onCreateSelectionChange = (count: number) => {
    createSelectionCountRef.current = count;
    setCreateSelectionCount(count);
  };
  const [updating, setUpdating] = useState(false);
  useEffect(() => subscribeUpdate(state => setUpdating(state.applying)), []);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const pageHiddenRef = useRef(false);
  useEffect(() => { window.__toolReady = !updating && !pageHiddenRef.current; }, [updating]);
  const controllerRef = useRef<WorkbenchController | null>(null);
  const [controllerBusy, setControllerBusy] = useState(false);
  if (!controllerRef.current) controllerRef.current = new WorkbenchController(publish, setControllerBusy);
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
  useEffect(() => {
    const dropped = (event: Event) => {
      if (isUpdateApplying() || sessionRef.current.op === 'create') { window.dispatchEvent(new Event('filesProcessed')); return; }
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
  const operations = AVAILABLE_OPS.filter(entry => !session.source || session.source.kind === 'zip' || entry.archive);
  // The menu and the panels follow the same operation; a state op that is not published falls back to the route.
  const activeOp = AVAILABLE_OPS.find(entry => entry.id === session.op)?.id ?? requestedOp(route.page);
  const failure = session.inputFailure;
  const inputError = failure && failureText(failure, t, 'input');
  const busy = controllerBusy || isWorkbenchBusy(session, controllerRef.current);
  const isSafeToUpdate = () => isWorkbenchUpdateSafe(sessionRef.current, controllerRef.current, createSelectionCountRef.current);
  const results = session.results;
  const canReset = busy || Boolean(createSelectionCount || session.source || session.inputFailure || results.length || session.listing.status !== 'idle' || session.job.status !== 'idle' ||
    session.create.input.length || session.create.result || session.create.run.status !== 'idle');
  return <div class="workbench">
    <PwaStartup locale={route.locale} busy={busy} hasWork={Boolean(createSelectionCount || session.source || results.length ||
      session.create.input.length || session.create.run.status === 'running' || session.create.result)} isSafe={isSafeToUpdate} />
    <GlobalDropZone locale={route.locale} disabled={updating} />
    {updating && <Status>{updateUi[route.locale].applying}</Status>}
    <div class="workbench__layout">
    <OperationMenu locale={route.locale} operations={operations} selected={activeOp} onSelect={selectOp} />
    <div class="workbench__workspace">
    <label class="workbench__language">{ui[route.locale].shared.language} <select aria-label={ui[route.locale].shared.language} value={route.locale} onChange={event => {
      const next = LOCALES.find(entry => entry.code === event.currentTarget.value);
      if (next) navigate({ locale: next.code, page: routeRef.current.page });
    }}>{LOCALES.map(entry => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></label>
    <AppCard title={t.input} className="workbench__input-card">
      {session.op !== 'create' && <label class="workbench__picker"><span>{t.choose}</span><span id="workbench-drop-hint" class="workbench__hint">{copy.dropHint}</span><input type="file" aria-label={t.choose} aria-describedby="workbench-drop-hint" disabled={busy || updating} onChange={event => {
        const input = event.currentTarget;
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (files.length && !isUpdateApplying()) void controllerRef.current?.accept(files, session);
      }} /></label>}
      {session.source && <p class="workbench__source">{t.source}: <span class="workbench__filename">{session.source.file.name}</span> <span class="workbench__kind">({session.source.kind})</span></p>}
      {session.source?.kind === 'unknown' && <Alert>{t.unknown}</Alert>}
      {inputError && <Alert>{inputError}</Alert>}
      {canReset && <AppButton variant="secondary" ariaLabel={`${t.reset}: ${session.source?.file.name ?? t.input}`} onClick={() => controllerRef.current?.reset()}>{t.reset}</AppButton>}
    </AppCard>
    {session.listing.status === 'reading' && <Status spinning>{t.busy}</Status>}
    {session.listing.status === 'error' && <div><Alert>{failureText(session.listing.failure, t, 'listing')} {session.source?.kind === 'zip' ? t.listingZip : session.source?.kind === 'rar' || session.source?.kind === '7z' ? t.listingArchive : session.source?.kind === 'tar' || session.source?.kind === 'gzip' ? t.listingTar : t.listingUnknown}</Alert>
      <AppButton variant="secondary" ariaLabel={`${t.retryListing}: ${session.source?.file.name}`} disabled={busy} onClick={() => void controllerRef.current?.retryListing(session)}>{t.retryListing}</AppButton></div>}
    {operations.map(({ id }) => {
      const Panel = panelRegistry[id];
      return <section key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} tabIndex={0} hidden={activeOp !== id}>
        <Panel session={session} locale={route.locale} t={t} busy={busy} updating={updating} publish={publish} active={activeOp === id}
          onCreate={files => { if (!isUpdateApplying()) void controllerRef.current?.createFrom(files, sessionRef.current); }}
          onCreateSelectionChange={onCreateSelectionChange}
          onNavigate={next => { selectOp(next); document.getElementById(`tab-${next}`)?.focus(); }}
          onRun={() => { if (!isUpdateApplying()) void controllerRef.current?.run(session); }} />
      </section>;
    })}
    {ready && <>
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
    </div>
    </div>
  </div>;
}
