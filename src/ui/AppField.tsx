import type { JSX } from 'preact';
import { ENGLISH_LOCALE, type Locale } from '@/i18n/locales';
import { ui } from '@/i18n/ui';
import { Alert } from './WorkbenchFeedback';

export interface AppFieldProps {
  label: string; id: string; type?: 'text' | 'number' | 'email' | 'password';
  value: string | number; onChange: (value: string | number) => void;
  required?: boolean; disabled?: boolean; error?: string; helpText?: string;
  placeholder?: string; min?: number; max?: number; step?: number; locale?: Locale;
}

export function AppField({ label, id, type = 'text', value, onChange, required = false,
  disabled = false, error, helpText, placeholder, min, max, step, locale = ENGLISH_LOCALE }: AppFieldProps) {
  const handleInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    onChange(type === 'number' ? event.currentTarget.valueAsNumber || 0 : event.currentTarget.value);
  };
  const description = [error && `${id}-error`, helpText && `${id}-help`].filter(Boolean).join(' ') || undefined;
  return <div class={`app-field ${error ? 'app-field--error' : ''}`}>
    <label class="app-field__label" for={id}>{label}{required && <span class="app-field__required">{ui[locale].shared.required}</span>}</label>
    <input id={id} type={type} class="app-field__input" value={value} onInput={handleInput}
      disabled={disabled} placeholder={placeholder} min={min} max={max} step={step} required={required}
      aria-invalid={!!error} aria-describedby={description} />
    {error && <Alert id={`${id}-error`} className="app-field__error">{error}</Alert>}
    {helpText && <div id={`${id}-help`} class="app-field__help">{helpText}</div>}
  </div>;
}
