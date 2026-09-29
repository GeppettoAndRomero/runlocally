import type { Locale } from './locales';
import type { UiStrings } from './types';
import { ui as ja } from './ja/ui';
import { ui as en } from './en/ui';

export const ui: Record<Locale, UiStrings> = { ja, en };
