import { ENGLISH_LOCALE, LOCALES, type Locale } from './locales';
import type { UiStrings, UpdateStrings } from './types';
const modules = import.meta.glob<{ ui: UiStrings; update: UpdateStrings }>('./*/ui.ts', { eager: true });
const reference = modules[`./${ENGLISH_LOCALE}/ui.ts`]?.ui;
if (!reference) throw new Error(`Missing UI dictionary: ${ENGLISH_LOCALE}`);
export const ui = Object.fromEntries(LOCALES.map(({ code }) => {
  const dictionary = modules[`./${code}/ui.ts`]?.ui;
  if (!dictionary) throw new Error(`Missing UI dictionary: ${code}`);
  for (const section of ['shared', 'workbench'] as const) {
    for (const key of Object.keys(reference[section])) {
      const value = (dictionary[section] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing UI text: ${code}/${section}/${key}`);
    }
  }
  return [code, dictionary];
})) as Record<Locale, UiStrings>;
export const updateUi = Object.fromEntries(LOCALES.map(({ code }) => [code, modules[`./${code}/ui.ts`]?.update])) as Record<Locale, UpdateStrings>;
