import type { ImageStage } from '../../engine/image/convert';
import type { Locale } from '../../i18n/locales';
import { imageProgressContent } from '../../i18n/image-progress';
import './progress-panel.css';

export interface ImageProgressProps {
  locale: Locale;
  done: number;
  total: number;
  current?: { name: string; stage: ImageStage } | null;
}
const positions: Record<ImageStage, number> = { reading: 1, decoding: 2, 'heic-decoder-preparing': 2, drawing: 3, encoding: 4 };
export function ProgressPanel({ locale, done, total, current }: ImageProgressProps) {
  if (total <= 0) return null;
  const t = imageProgressContent(locale);
  return <div class="progress-panel">
    <progress value={done} max={total} aria-label={t.label} />
    <span>{t.count.replace('{done}', String(done)).replace('{total}', String(total))}</span>
    {current && <div>
      <p>{t.processing}{current.name} — {t.stages[current.stage]}</p>
      <div class="progress-panel__stages" aria-hidden="true">{[1, 2, 3, 4].map(position =>
        <span key={position} class={position <= positions[current.stage] ? 'is-reached' : ''} />)}</div>
    </div>}
  </div>;
}
