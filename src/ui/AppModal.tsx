import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ENGLISH_LOCALE, type Locale } from '@/i18n/locales';
import { ui } from '@/i18n/ui';

export interface AppModalProps { isOpen: boolean; onClose: () => void; title: string; children: ComponentChildren; locale?: Locale }

export function AppModal({ isOpen, onClose, title, children, locale = ENGLISH_LOCALE }: AppModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); document.body.style.overflow = previous; };
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  return <div class="app-modal-backdrop" onClick={onClose}>
    <div class="app-modal" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <div class="app-modal__header"><h2>{title}</h2><button type="button" onClick={onClose} aria-label={ui[locale].shared.close}>×</button></div>
      <div class="app-modal__content">{children}</div>
    </div>
  </div>;
}
