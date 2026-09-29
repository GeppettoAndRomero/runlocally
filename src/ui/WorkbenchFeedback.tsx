import type { ComponentChildren } from 'preact';

function Symbol({ alert = false }: { alert?: boolean }) {
  return <svg class="feedback__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    {alert ? <><circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/></> : <><circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/></>}
  </svg>;
}
export function Alert({ children, id, className = '' }: { children: ComponentChildren; id?: string; className?: string }) {
  return <div id={id} class={`feedback feedback--alert ${className}`} role="alert"><Symbol alert /><span>{children}</span></div>;
}
export function Status({ children, className = '', progress, label, spinning = false, bare = false }: {
  children: ComponentChildren; className?: string; progress?: { done: number; total: number }; label?: string; spinning?: boolean; bare?: boolean;
}) {
  if (bare) return <div class={`feedback feedback--status ${className}`} role="status">{children}</div>;
  const valid = progress && Number.isFinite(progress.done) && Number.isFinite(progress.total) && progress.total > 0 && progress.done >= 0 && progress.done <= progress.total;
  return <div class={`feedback feedback--status ${className}`} role="status">
    {spinning ? <span class="feedback__spinner" aria-hidden="true" /> : <Symbol />}
    <span>{children}</span>
    {valid && <progress value={progress.done} max={progress.total} aria-label={label} />}
  </div>;
}
