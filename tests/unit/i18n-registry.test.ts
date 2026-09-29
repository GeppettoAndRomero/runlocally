import { describe, expect, it } from 'vitest';
import config from '../../astro.config.mjs';
import { DEFAULT_LOCALE, ENGLISH_LOCALE, LOCALES } from '../../src/i18n/locales';
import { AVAILABLE_OPS, OPS, type AvailableOpId, type RegistryOpId } from '../../src/i18n/ops';
import { workerApi } from '../../src/engine/worker-api';
import { openArchive } from '../../src/engine/archive/libarchive';
import type { OpId } from '../../src/app/state/session';
import type { UiStrings } from '../../src/i18n/types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const availableMatchesSession: Equal<AvailableOpId, OpId> = true;
const futureIsExcluded: Equal<Exclude<RegistryOpId, OpId>, 'recover' | 'split' | 'merge' | 'unlock' | 'encrypt' | 'create' | 'rar-7z'> = true;
// @ts-expect-error A required shared label cannot be omitted.
const missingShared: UiStrings['shared'] = { close: 'Close' };
// @ts-expect-error A required workbench label cannot be omitted.
const missingWorkbench: UiStrings['workbench'] = { browse: 'Browse' };
void [availableMatchesSession, futureIsExcluded, missingShared, missingWorkbench];

describe('locales and operation registry', () => {
  it('has one default and distinct codes', () => {
    expect(new Set(LOCALES.map(locale => locale.code)).size).toBe(LOCALES.length);
    expect(LOCALES.filter(locale => locale.default)).toHaveLength(1);
    expect(DEFAULT_LOCALE).toBe(LOCALES.find(locale => locale.default)?.code);
    expect(ENGLISH_LOCALE).toBe(LOCALES.find(locale => locale.code === 'en')?.code);
  });

  it('passes only codes to Astro', () => {
    expect(config.i18n?.locales).toEqual(LOCALES.map(locale => locale.code));
    expect(config.i18n?.defaultLocale).toBe(DEFAULT_LOCALE);
    expect(config.i18n?.routing).toEqual({ prefixDefaultLocale: false });
  });

  it('has unique public identifiers and only four available operations', () => {
    for (const key of ['id', 'slug', 'i18nKey'] as const) {
      expect(new Set(OPS.map(op => op[key])).size).toBe(OPS.length);
    }
    expect(OPS).toHaveLength(11);
    expect(AVAILABLE_OPS).toEqual(OPS.filter(op => op.available));
    expect(AVAILABLE_OPS.map(op => op.id)).toEqual(['browse', 'extract', 'remove', 'fix-names']);
    expect(OPS.filter(op => !op.available)).toHaveLength(7);
    expect(OPS.filter(op => op.engineOp === 'rewriteZip')).toHaveLength(4);
  });

  it('points available operations at actual engine exports', () => {
    const api = { ...workerApi, openArchive };
    for (const op of AVAILABLE_OPS) expect(typeof api[op.engineOp]).toBe('function');
  });
});
