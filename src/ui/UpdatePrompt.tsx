import { useEffect, useRef, useState } from 'preact/hooks';
import type { Locale } from '../i18n/locales';
import { ui, updateUi } from '../i18n/ui';
import { applyUpdate, registerSW, retrySW, subscribeUpdate, type UpdateState } from '../app/registerSW';
import { AppButton } from './AppButton';
import { Alert, Status } from './WorkbenchFeedback';

export function UpdatePrompt({ locale, busy, hasWork, isSafe }: { locale: Locale; busy: boolean; hasWork: boolean; isSafe?: () => boolean }) {
  const [update, setUpdate] = useState<UpdateState>({ waiting: null, error: null, otherTabs: false, canCoordinate: false, applying: false, reloadDeferred: false });
  const [later, setLater] = useState(false);
  const workRef = useRef({ busy, hasWork });
  workRef.current = { busy, hasWork };
  const safeRef = useRef(isSafe);
  safeRef.current = isSafe;
  useEffect(() => {
    const unsubscribe = subscribeUpdate(next => { setUpdate(previous => {
      if (next.waiting !== previous.waiting) setLater(false);
      return next;
    }); });
    // The install prompt subscribes during mount before registration begins.
    const timer = setTimeout(() => { void registerSW(); }, 0);
    return () => { clearTimeout(timer); unsubscribe(); };
  }, []);
  const t = updateUi[locale];
  if (!update.waiting && !update.error && !update.reloadDeferred && !update.applying) return null;
  if (later && !update.error && !update.reloadDeferred && !update.applying) return null;
  const blocked = busy || hasWork || update.otherTabs || !update.canCoordinate || update.applying;
  return <div class="update-prompt" role="region" aria-label={t.title}>
    {update.waiting && <p>{t.title}</p>}
    {update.applying && <Status>{t.applying}</Status>}
    {update.reloadDeferred && <Status>{t.reloadDeferred}</Status>}
    {busy && <p>{t.busy}</p>}
    {hasWork && <p>{t.work}</p>}
    {update.otherTabs && <p>{t.tabs}</p>}
    {update.waiting && !update.canCoordinate && !update.applying && <p>{t.coordination}</p>}
    {update.error && <Alert>{t.error}</Alert>}
    {update.waiting && !update.reloadDeferred && <AppButton disabled={blocked} onClick={() => { void applyUpdate(() => safeRef.current ? safeRef.current() : !workRef.current.busy && !workRef.current.hasWork); }}>{t.now}</AppButton>}
    {update.error && <AppButton variant="secondary" onClick={() => { void retrySW(); }}>{t.retry}</AppButton>}
    {update.waiting && !update.applying && <AppButton variant="secondary" onClick={() => setLater(true)}>{ui[locale].shared.later}</AppButton>}
  </div>;
}
