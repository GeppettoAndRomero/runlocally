// Add a locale only with evidence of demand and native review capacity; see docs/PRINCIPLES.md.
export const LOCALES = ['ja', 'en'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'ja';
