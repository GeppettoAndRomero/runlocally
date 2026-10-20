import { useEffect, useState } from 'preact/hooks';
import { AppButton } from '../../ui/AppButton';
import { AppCard } from '../../ui/AppCard';
import { Alert } from '../../ui/WorkbenchFeedback';
import { directoryState, keptFileCount } from '../state/reducer';
import { repairPlan } from '../rewrite-plan';
import type { PanelDefinitions, PanelProps } from './index';

const PAGE_SIZE = 500;
function usePage(generation: number) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [generation]);
  return [page, setPage] as const;
}
function EntryIcon({ directory }: { directory: boolean }) {
  return directory
    ? <svg class="workbench__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 6.5h7l2 2h10v10h-19z" stroke-linejoin="round" /></svg>
    : <svg class="workbench__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 2.5h9l5 5v14H5zM14 2.5v5h5" stroke-linejoin="round" /></svg>;
}
export function BrowsePanel({ session, t, publish, onNavigate }: PanelProps) {
  const ready = session.listing.status === 'ready';
  const notReadyCopy = session.listing.status === 'reading' ? t.busy : session.listing.status === 'error' ? t.retryListing : t.choose;
  const zip = session.listing.status === 'ready' && session.listing.route === 'zip';
  const entries = zip ? session.entries.map((entry) => ({ name: entry.name, size: entry.size, directory: entry.directory,
    eligible: !entry.directory && !entry.encrypted })) : session.archiveEntries.map(entry => ({ name: entry.path, size: entry.size, eligible: true }));
  const fileCount = zip ? session.entries.filter(entry => !entry.directory).length : entries.length;
  const eligible = entries.filter(entry => entry.eligible).length;
  const [page, setPage] = usePage(session.generation);
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visible = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const duplicates = zip && new Set(session.entries.map(entry => entry.name)).size !== session.entries.length;
  return <>
      {!ready && <AppCard title={t.browse}><p class="workbench__not-ready">{notReadyCopy}</p></AppCard>}
      {ready && <>
        <AppCard title={t.browse}>
          <p>{t.entries}: {entries.length} / {t.files}: {fileCount} / {t.eligible}: {eligible}</p>
          {duplicates && <p>{t.duplicate}</p>}
          <div class="workbench__list" role="list">{visible.map((entry, index) => <div role="listitem" class="workbench__row" key={`${page}-${index}`}>
            <span class="workbench__entry"><EntryIcon directory={'directory' in entry && entry.directory === true} /><span class="workbench__name">{entry.name}</span></span><span class="workbench__size">{entry.size} B</span>
            {entry.eligible && <AppButton variant="ghost" ariaLabel={`${t.chooseOne}: ${entry.name}`} onClick={() => {
              publish({ type: 'op/input', op: 'extract', input: { mode: 'one', name: entry.name } });
              onNavigate('extract');
            }}>{t.chooseOne}</AppButton>}
          </div>)}</div>
          <nav class="workbench__pages" aria-label={t.page}>
            <AppButton variant="secondary" ariaLabel={`${t.previous}: ${t.browse} ${t.page}`} disabled={page === 0} onClick={() => setPage(page - 1)}>{t.previous}</AppButton>
            <span>{t.page} {page + 1} / {pages}</span>
            <AppButton variant="secondary" ariaLabel={`${t.next}: ${t.browse} ${t.page}`} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t.next}</AppButton>
          </nav>
        </AppCard></>}
  </>;
}

export function ExtractPanel({ session, t, publish, busy, updating, onRun }: PanelProps) {
  const ready = session.listing.status === 'ready';
  const notReadyCopy = session.listing.status === 'reading' ? t.busy : session.listing.status === 'error' ? t.retryListing : t.choose;
  const zip = session.listing.status === 'ready' && session.listing.route === 'zip';
  const entries = zip ? session.entries.map((entry) => ({ name: entry.name, size: entry.size, directory: entry.directory,
    eligible: !entry.directory && !entry.encrypted })) : session.archiveEntries.map(entry => ({ name: entry.path, size: entry.size, eligible: true }));
  const eligible = entries.filter(entry => entry.eligible).length;
  const extractInput = session.inputs.extract;
  const currentOne = extractInput.mode === 'one' && entries.some(entry => entry.name === extractInput.name && entry.eligible);
  return <>
      {!ready && <AppCard title={t.extract}><p class="workbench__not-ready">{notReadyCopy}</p></AppCard>}
      {ready && <>
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
          <AppButton ariaLabel={`${t.run}: ${extractInput.mode === 'one' ? extractInput.name : session.source?.file.name}`} disabled={busy || updating || (extractInput.mode === 'one' && !currentOne)} onClick={onRun}>{t.run}</AppButton>
        </AppCard></>}
  </>;
}

export function RemovePanel({ session, t, publish, onNavigate, busy, updating, onRun }: PanelProps) {
  const ready = session.listing.status === 'ready';
  const notReadyCopy = session.listing.status === 'reading' ? t.busy : session.listing.status === 'error' ? t.retryListing : t.choose;
  const zip = session.listing.status === 'ready' && session.listing.route === 'zip';
  const duplicates = zip && new Set(session.entries.map(entry => entry.name)).size !== session.entries.length;
  const removed = zip ? session.entries.filter(entry => !session.selection.has(entry.name)).length : 0;
  const keptFiles = zip ? keptFileCount(session.entries, session.selection) : 0;
  const repair = repairPlan(zip ? session.entries : []);
  const hasCandidates = zip && repair.changes.length > 0;
  const encryptedKept = zip && session.entries.some(entry => entry.encrypted && session.selection.has(entry.name));
  const [removePage, setRemovePage] = usePage(session.generation);
  return <>
      {!ready && <AppCard title={t.remove}><p class="workbench__not-ready">{notReadyCopy}</p></AppCard>}
      {ready && <>
        <AppCard title={t.remove}>
          <p>{t.removeGuide}</p>
          {duplicates && <p>{t.duplicateKeep}</p>}
          {hasCandidates && <p>{t.orderGuide} <AppButton variant="ghost" ariaLabel={`${t.goRepair}: ${session.source?.file.name}`} onClick={() => { onNavigate('fix-names'); }}>{t.goRepair}</AppButton></p>}
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
          <AppButton ariaLabel={`${t.removeRun}: ${session.source?.file.name}`} disabled={busy || updating || removed === 0 || keptFiles === 0} onClick={onRun}>{t.removeRun}</AppButton>
        </AppCard></>}
  </>;
}

export function FixNamesPanel({ session, t, busy, updating, onRun }: PanelProps) {
  const ready = session.listing.status === 'ready';
  const notReadyCopy = session.listing.status === 'reading' ? t.busy : session.listing.status === 'error' ? t.retryListing : t.choose;
  const zip = session.listing.status === 'ready' && session.listing.route === 'zip';
  const repair = repairPlan(zip ? session.entries : []);
  const [repairPage, setRepairPage] = usePage(session.generation);
  return <>
      {!ready && <AppCard title={t['fix-names']}><p class="workbench__not-ready">{notReadyCopy}</p></AppCard>}
      {ready && <>
        <AppCard title={t['fix-names']}>
          <p>{t.repairGuide}</p><p>{t.plannedRepair}: {repair.changes.length}{t.entriesUnit}</p>
          {repair.collision && <Alert>{t.collision}{repair.collision}</Alert>}
          <div class="workbench__list" role="list" aria-label={t['fix-names']}>{repair.changes.slice(repairPage * PAGE_SIZE, (repairPage + 1) * PAGE_SIZE).map((change, index) =>
            <div role="listitem" class="workbench__row workbench__repair-row" key={`${repairPage}-${index}`}><span class="workbench__name">{t.repairBefore}: {change.before}</span><span class="workbench__name">{t.repairAfter}: {change.after}</span></div>)}</div>
          <nav class="workbench__pages" aria-label={`${t['fix-names']} ${t.page}`}><AppButton variant="secondary" ariaLabel={`${t.previous}: ${t['fix-names']} ${t.page}`} disabled={repairPage === 0} onClick={() => setRepairPage(repairPage - 1)}>{t.previous}</AppButton>
            <span>{t.page} {repairPage + 1} / {Math.max(1, Math.ceil(repair.changes.length / PAGE_SIZE))}</span>
            <AppButton variant="secondary" ariaLabel={`${t.next}: ${t['fix-names']} ${t.page}`} disabled={(repairPage + 1) * PAGE_SIZE >= repair.changes.length} onClick={() => setRepairPage(repairPage + 1)}>{t.next}</AppButton></nav>
          <AppButton ariaLabel={`${t.repairRun}: ${session.source?.file.name}`} disabled={busy || updating || repair.changes.length === 0 || Boolean(repair.collision)} onClick={onRun}>{t.repairRun}</AppButton>
        </AppCard></>}
  </>;
}

export const panels = { browse: BrowsePanel, extract: ExtractPanel, remove: RemovePanel, 'fix-names': FixNamesPanel } satisfies PanelDefinitions;
