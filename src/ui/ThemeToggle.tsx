import { useEffect, useState } from 'preact/hooks';
import type { Locale } from '@/i18n/locales';
import { strings } from './strings';

export type Theme = 'light' | 'dark' | 'auto';
const key = 'runlocally-theme';
function storedTheme(): Theme {
  try { const value = localStorage.getItem(key); if (value === 'light' || value === 'dark' || value === 'auto') return value; } catch { /* storage may be unavailable */ }
  return 'light';
}
function systemTheme(): 'light' | 'dark' { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
export function ThemeToggle({ locale = 'en' }: { locale?: Locale }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [system, setSystem] = useState<'light' | 'dark'>('light');
  useEffect(() => { setTheme(storedTheme()); setSystem(systemTheme()); }, []);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setSystem(media.matches ? 'dark' : 'light');
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []);
  const actual = theme === 'auto' ? system : theme;
  useEffect(() => { document.documentElement.setAttribute('data-theme', actual); }, [actual]);
  const toggle = () => {
    const next = actual === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(key, next); } catch { /* storage may be unavailable */ }
  };
  const label = actual === 'dark' ? strings[locale].themeToLight : strings[locale].themeToDark;
  return <button type="button" class="theme-toggle" onClick={toggle} aria-label={label} title={label}>
    <span aria-hidden="true">{actual === 'dark' ? '☀️' : '🌙'}</span><span class="theme-toggle__text">{strings[locale].themeLabel}</span>
  </button>;
}
