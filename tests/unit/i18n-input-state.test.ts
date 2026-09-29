import { describe, expect, it } from 'vitest';
import { inputStateCopy } from '../../src/ui/input-state-copy';
import { LOCALES } from '../../src/i18n/locales';
import type { InputStateKey } from '../../src/i18n/types';

const keys = ['dropHint', 'emptyResults', 'progressLabel'] as const satisfies readonly InputStateKey[];
describe('input state text', () => {
  it('covers each locale with the finite nonempty key set', () => {
    expect(Object.keys(inputStateCopy).sort()).toEqual(LOCALES.map(entry => entry.code).sort());
    for (const { code } of LOCALES) {
      expect(Object.keys(inputStateCopy[code]).sort()).toEqual([...keys].sort());
      expect(Object.values(inputStateCopy[code]).every(value => value.trim().length > 0)).toBe(true);
    }
  });
});
