import { ENGLISH_LOCALE, LOCALES, type Locale } from '../i18n/locales';
import type { InputStateKey, InputStateStrings, UiStrings } from '../i18n/types';

const keys = ['dropHint', 'emptyResults', 'progressLabel'] as const satisfies readonly InputStateKey[];
const modules = import.meta.glob<{ ui: UiStrings }>('../i18n/*/ui.ts', { eager: true });
const reference = modules[`../i18n/${ENGLISH_LOCALE}/ui.ts`]?.ui.inputState;
if (!reference) throw new Error(`Missing input state dictionary: ${ENGLISH_LOCALE}`);
export const inputStateCopy = Object.fromEntries(LOCALES.map(({ code }) => {
  const copy = modules[`../i18n/${code}/ui.ts`]?.ui.inputState;
  if (!copy) throw new Error(`Missing input state dictionary: ${code}`);
  for (const key of keys) {
    if (typeof copy[key] !== 'string' || !copy[key].trim() || typeof reference[key] !== 'string' || !reference[key].trim())
      throw new Error(`Missing input state text: ${code}/${key}`);
  }
  if (Object.keys(copy).length !== keys.length) throw new Error(`Unexpected input state text: ${code}`);
  return [code, copy];
})) as Record<Locale, InputStateStrings>;
