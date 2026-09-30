import { ENGLISH_LOCALE, LOCALES, type Locale } from './locales';
import { AVAILABLE_OPS } from './ops';
import type { UiStrings, UpdateStrings } from './types';
const modules = import.meta.glob<{ ui: UiStrings; update: UpdateStrings }>('./*/ui.ts', { eager: true });
const reference = modules[`./${ENGLISH_LOCALE}/ui.ts`]?.ui;
if (!reference) throw new Error(`Missing UI dictionary: ${ENGLISH_LOCALE}`);
const dictionaries = Object.fromEntries(LOCALES.map(({ code }) => {
  const dictionary = modules[`./${code}/ui.ts`]?.ui;
  if (!dictionary) throw new Error(`Missing UI dictionary: ${code}`);
  for (const section of ['shared', 'workbench', 'chrome'] as const) {
    for (const key of Object.keys(reference[section])) {
      const value = (dictionary[section] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing UI text: ${code}/${section}/${key}`);
    }
  }
  const menu = dictionary.menu as Record<string, unknown> | undefined;
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) {
    throw new Error(`Missing UI text: ${code}/menu`);
  }
  const expectedOps = new Set<string>(AVAILABLE_OPS.map(op => op.i18nKey));
  for (const op of expectedOps) {
    if (!Object.hasOwn(menu, op)) throw new Error(`Missing UI text: ${code}/menu/${op}`);
  }
  for (const op of Object.keys(menu)) {
    if (!expectedOps.has(op)) throw new Error(`Unexpected UI text: ${code}/menu/${op}`);
    const entry = menu[op];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Missing UI text: ${code}/menu/${op}`);
    }
    const fields = entry as Record<string, unknown>;
    for (const field of ['verb', 'description'] as const) {
      if (typeof fields[field] !== 'string' || !fields[field].trim()) {
        throw new Error(`Missing UI text: ${code}/menu/${op}/${field}`);
      }
    }
    for (const field of Object.keys(fields)) {
      if (field !== 'verb' && field !== 'description') {
        throw new Error(`Unexpected UI text: ${code}/menu/${op}/${field}`);
      }
    }
  }
  return [code, dictionary];
})) as Record<Locale, UiStrings>;
export const ui = Object.fromEntries(LOCALES.map(({ code }) => [code, {
  shared: dictionaries[code].shared, workbench: dictionaries[code].workbench,
}])) as Record<Locale, Pick<UiStrings, 'shared' | 'workbench'>>;
export const chromeUi = Object.fromEntries(LOCALES.map(({ code }) => [code, dictionaries[code].chrome])) as Record<Locale, UiStrings['chrome']>;
export const menuUi = Object.fromEntries(LOCALES.map(({ code }) => [code, dictionaries[code].menu])) as Record<Locale, UiStrings['menu']>;
export const updateUi = Object.fromEntries(LOCALES.map(({ code }) => [code, modules[`./${code}/ui.ts`]?.update])) as Record<Locale, UpdateStrings>;
