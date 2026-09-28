import { useEffect, useRef, useState } from 'preact/hooks';
import type { Locale } from '@/i18n/locales';
import { strings } from './strings';
import { AppButton } from './AppButton';

export interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
type DisplayMode = 'banner' | 'footer' | 'hidden';
const modeKey = 'runlocally-install-prompt-mode';
const dismissedKey = 'runlocally-install-prompt-dismissed';
const week = 7 * 24 * 60 * 60 * 1000;
function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } }
export function InstallPrompt({ locale = 'en' }: { locale?: Locale }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [mode, setMode] = useState<DisplayMode>('hidden');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const receive = (incoming: Event) => {
      incoming.preventDefault();
      if (window.matchMedia?.('(display-mode: standalone)').matches) return;
      setEvent(incoming as InstallEvent);
      const dismissed = Number(read(dismissedKey));
      const saved = read(modeKey);
      setMode(dismissed && Date.now() - dismissed >= week ? 'banner' : saved === 'footer' || saved === 'hidden' ? saved : 'banner');
    };
    window.addEventListener('beforeinstallprompt', receive);
    return () => { mounted.current = false; window.removeEventListener('beforeinstallprompt', receive); };
  }, []);
  const install = async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    if (mounted.current) { setEvent(null); setMode('hidden'); write(modeKey, 'hidden'); }
  };
  const dismiss = (next: DisplayMode) => { setMode(next); write(modeKey, next); if (next === 'hidden') write(dismissedKey, String(Date.now())); };
  if (!event || mode === 'hidden') return null;
  const t = strings[locale];
  return mode === 'banner' ? <div class="install-prompt" role="region" aria-label={t.installTitle}>
    <h3>{t.installTitle}</h3><p>{t.installBody}</p>
    <AppButton onClick={install}>{t.install}</AppButton> <AppButton variant="ghost" onClick={() => dismiss('footer')}>{t.later}</AppButton>
    <button type="button" onClick={() => dismiss('footer')} aria-label={t.close}>×</button>
  </div> : <div class="install-prompt install-prompt--footer">
    <button type="button" onClick={install}>{t.installTitle}</button>
    <button type="button" onClick={() => dismiss('hidden')} aria-label={t.close}>×</button>
  </div>;
}
