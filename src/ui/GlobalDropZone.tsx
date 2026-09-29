import { useEffect, useState } from 'preact/hooks';
import { ENGLISH_LOCALE, type Locale } from '@/i18n/locales';
import { ui } from '@/i18n/ui';

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () => reader.readEntries(batch => {
      if (!batch.length) resolve(all);
      else { all.push(...batch); next(); }
    }, reject);
    next();
  });
}
function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
async function collect(entry: FileSystemEntry, output: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    const path = entry.fullPath.replace(/^\/+/, '');
    if (path && path !== file.name) {
      try { Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true }); }
      catch { /* retain the file without its folder path */ }
    }
    output.push(file);
  } else if (entry.isDirectory) {
    for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) await collect(child, output);
  }
}
async function expand(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) await collect(entry, files);
  return files;
}
export function GlobalDropZone({ locale = ENGLISH_LOCALE, disabled = false }: { locale?: Locale; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    let pendingScans = 0;
    let awaitingProcessed = 0;
    let depth = 0;
    const updateProcessing = () => {
      const busy = pendingScans + awaitingProcessed > 0;
      setProcessing(busy);
      if (!busy) setCount(0);
    };
    const dragEnter = (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); if (++depth === 1) setDragging(true); };
    const dragLeave = (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const dragOver = (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); };
    const dispatch = (files: File[]) => {
      if (!active || disabled || !files.length) return;
      awaitingProcessed++;
      setCount(files.length);
      updateProcessing();
      window.dispatchEvent(new CustomEvent<File[]>('filesDropped', { detail: files }));
    };
    const drop = (event: DragEvent) => {
      event.preventDefault(); event.stopPropagation(); depth = 0; setDragging(false);
      const data = event.dataTransfer;
      const flat = Array.from(data?.files ?? []);
      const entries: FileSystemEntry[] = [];
      for (const item of Array.from(data?.items ?? [])) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length) {
        pendingScans++;
        setCount(flat.length || entries.length);
        updateProcessing();
        expand(entries).then(files => files.length ? files : flat, () => flat).then(result => {
          if (!active) return;
          pendingScans--;
          if (result.length) dispatch(result); else updateProcessing();
        });
      } else if (flat.length) dispatch(flat);
    };
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (files.length) { event.preventDefault(); dispatch(files); }
    };
    const processed = () => { if (awaitingProcessed) awaitingProcessed--; updateProcessing(); };
    document.body.addEventListener('dragenter', dragEnter);
    document.body.addEventListener('dragleave', dragLeave);
    document.body.addEventListener('dragover', dragOver);
    document.body.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    window.addEventListener('filesProcessed', processed);
    return () => {
      active = false;
      document.body.removeEventListener('dragenter', dragEnter);
      document.body.removeEventListener('dragleave', dragLeave);
      document.body.removeEventListener('dragover', dragOver);
      document.body.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
      window.removeEventListener('filesProcessed', processed);
    };
  }, [disabled]);
  if (!dragging && !processing) return null;
  const t = ui[locale].shared;
  return <div class="global-drop-zone" role="status">
    <span aria-hidden="true">{processing ? '⏳' : '📁'}</span>
    <strong>{processing ? t.processing.replace('{count}', String(count)) : t.dropTitle}</strong>
    <span>{processing ? t.wait : t.dropHint}</span>
  </div>;
}
