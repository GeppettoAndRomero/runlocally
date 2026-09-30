import { useEffect, useState } from 'preact/hooks';
import type { Locale } from '../i18n/locales';
import type { AvailableOp, AvailableOpId } from '../i18n/ops';
import { chromeUi, menuUi } from '../i18n/ui';

interface Props {
  locale: Locale;
  operations: readonly AvailableOp[];
  selected: AvailableOpId;
  onSelect: (op: AvailableOpId) => void;
}

export function OperationMenu({ locale, operations, selected, onSelect }: Props) {
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(min-width: 48rem)');
    const sync = () => setOrientation(media.matches ? 'vertical' : 'horizontal');
    sync();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }
  }, []);
  return <div class="workbench__menu" data-workbench-menu role="tablist"
    aria-label={chromeUi[locale].navigation} aria-orientation={orientation}
    onKeyDown={event => {
      const forward = event.key === 'ArrowRight' || (orientation === 'vertical' && event.key === 'ArrowDown');
      const backward = event.key === 'ArrowLeft' || (orientation === 'vertical' && event.key === 'ArrowUp');
      if (!forward && !backward) return;
      event.preventDefault();
      const index = operations.findIndex(op => op.id === selected);
      const next = operations[(index + (forward ? 1 : operations.length - 1)) % operations.length];
      if (!next) return;
      onSelect(next.id);
      (event.currentTarget.querySelector(`[data-op="${next.id}"]`) as HTMLButtonElement | null)?.focus();
    }}>
    {operations.map(op => {
      const copy = menuUi[locale][op.i18nKey];
      return <button key={op.id} type="button" role="tab" data-op={op.id} id={`tab-${op.id}`}
        aria-controls={`panel-${op.id}`} aria-selected={selected === op.id} tabIndex={selected === op.id ? 0 : -1}
        aria-labelledby={`menu-verb-${op.id}`} aria-describedby={`menu-description-${op.id}`}
        onClick={() => onSelect(op.id)}>
        <span id={`menu-verb-${op.id}`} class="workbench__menu-verb">{copy.verb}</span>
        <span id={`menu-description-${op.id}`} class="workbench__menu-description">{copy.description}</span>
      </button>;
    })}
  </div>;
}
