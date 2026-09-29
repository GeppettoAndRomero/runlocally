// Add a locale only with evidence of demand and native review capacity; see docs/PRINCIPLES.md.
export const LOCALES = [
  { code: 'ja', default: true, hreflang: 'ja' },
  { code: 'en', default: false, hreflang: 'en' },
] as const;
export type Locale = typeof LOCALES[number]['code'];
export const DEFAULT_LOCALE = LOCALES.find(locale => locale.default)!.code;
export const ENGLISH_LOCALE = LOCALES.find(locale => locale.code === 'en')!.code;
