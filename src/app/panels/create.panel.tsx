import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createUi } from '../../i18n/ui';
import { AppButton } from '../../ui/AppButton';
import { AppCard } from '../../ui/AppCard';
import { Alert, Status } from '../../ui/WorkbenchFeedback';
import { downloadBlob } from '../download';
import { isUpdateApplying } from '../registerSW';
import { inputSizeFailure } from '../state/reducer';
import type { PanelDefinitions, PanelProps } from './index';

export function CreatePanel({ session, locale, busy, updating, active = false, onCreate, onCreateSelectionChange }: PanelProps) {
  const t = createUi[locale];
  const [files, setFiles] = useState<readonly File[]>([]);
  const selection = useRef(files);
  const notify = useRef(onCreateSelectionChange);
  notify.current = onCreateSelectionChange;
  const { run, result } = session.create;
  const blocked = !active || busy || updating || run.status === 'running';
  const tooLarge = Boolean(inputSizeFailure(files.reduce((sum, file) => sum + file.size, 0)));
  function select(next: readonly File[]) {
    selection.current = next;
    setFiles(next);
    notify.current?.(next.length);
  }
  useLayoutEffect(() => { select([]); }, [session.generation]);
  useLayoutEffect(() => () => { notify.current?.(0); }, []);
  function add(incoming: readonly File[]) {
    if (blocked || isUpdateApplying()) return;
    const next = [...selection.current];
    for (const file of incoming) {
      // Only a file that matches in path, name, size and time is the same file added again; the same path from
      // another folder with different contents stays, and the engine numbers the colliding entry names.
      if (!next.some(existing => existing.webkitRelativePath === file.webkitRelativePath && existing.name === file.name
        && existing.size === file.size && existing.lastModified === file.lastModified)) next.push(file);
    }
    select(next);
  }
  useLayoutEffect(() => {
    if (!active) return;
    const dropped = (event: Event) => {
      if (window.__toolReady && event instanceof CustomEvent) add(event.detail);
    };
    window.addEventListener('filesDropped', dropped);
    return () => window.removeEventListener('filesDropped', dropped);
  }, [active, busy, updating, run.status, session.generation]);
  return <AppCard title={t.title}>
    <label class="workbench__choice workbench__choice--file">{t.addFiles}<input type="file" multiple disabled={blocked} onChange={event => {
      add(Array.from(event.currentTarget.files ?? []));
      event.currentTarget.value = '';
    }} /></label>
    <label class="workbench__choice workbench__choice--file">{t.addFolder}<input type="file" ref={node => node?.setAttribute('webkitdirectory', '')} disabled={blocked} onChange={event => {
      add(Array.from(event.currentTarget.files ?? []));
      event.currentTarget.value = '';
    }} /></label>
    <h3>{t.selectedCount}: {files.length}</h3>
    {files.length === 0 && <><p>{t.emptyGuide}</p><p>{t.emptySelection}</p></>}
    <div class="workbench__list" role="list">{files.map((file, index) => <div class="workbench__row" role="listitem" key={index}>
      <span class="workbench__name">{file.webkitRelativePath || file.name}</span><span class="workbench__size">{file.size} B</span>
    </div>)}</div>
    {tooLarge && <Alert>{t.tooLarge}</Alert>}
    <div class="workbench__actions">
      <AppButton variant="secondary" disabled={blocked || files.length === 0} onClick={() => {
        if (!blocked && !isUpdateApplying()) select([]);
      }}>{t.clearSelection}</AppButton>
      <AppButton disabled={blocked || !onCreate || files.length === 0 || tooLarge} onClick={() => {
        if (!blocked && !isUpdateApplying() && selection.current.length > 0
          && !inputSizeFailure(selection.current.reduce((sum, file) => sum + file.size, 0))) onCreate?.([...selection.current]);
      }}>{t.run}</AppButton>
    </div>
    {run.status === 'running' && <Status>{`${t.processingFile}: ${run.progress.index + 1} / ${run.progress.total} ${run.progress.name}`}</Status>}
    {run.status === 'failed' && <Alert>{t.failure} {t.retryGuide}</Alert>}
    {result && <>
      <h3>{t.resultSummary}: {result.count}</h3><p>{result.name}</p>
      <AppButton disabled={blocked} ariaLabel={`${t.save}: ${result.name}`} onClick={() => {
        if (!blocked && !isUpdateApplying()) downloadBlob(result.blob, result.name);
      }}>{t.save}</AppButton>
    </>}
  </AppCard>;
}

export const panels = { create: CreatePanel } satisfies PanelDefinitions;
