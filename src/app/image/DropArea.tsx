import type { ComponentProps } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Locale } from '../../i18n/locales';
import { imageToolContent } from '../../i18n/image-tool';
import './drop-area.css';

export function DropArea({ locale, disabled, onChange }: {
  locale: Locale; disabled: boolean; onChange: NonNullable<ComponentProps<'input'>['onChange']>;
}) {
  const t = imageToolContent(locale);
  const area = useRef<HTMLLabelElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const clear = () => { depth.current = 0; setDragging(false); };
  const files = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  useEffect(() => {
    clear();
    const outside = (event: DragEvent) => {
      if (!(event.target instanceof Node) || !area.current?.contains(event.target)) clear();
    };
    // Capture runs before the global receiver stops bubbling at body.
    document.addEventListener('drop', clear, true);
    document.addEventListener('dragend', clear, true);
    document.addEventListener('dragover', outside, true);
    window.addEventListener('pagehide', clear);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('drop', clear, true);
      document.removeEventListener('dragend', clear, true);
      document.removeEventListener('dragover', outside, true);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('blur', clear);
    };
  }, [disabled]);
  return <label ref={area} class={`image-drop-area${dragging && !disabled ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
    onDragEnter={event => { if (!disabled && files(event)) { depth.current++; setDragging(true); } }}
    onDragOver={event => {
      // A drag that re-enters after a reset (blur, drop) must restore the depth with the highlight.
      if (!disabled && files(event)) { if (!depth.current) depth.current = 1; setDragging(true); }
    }}
    onDragLeave={event => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current || (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))) clear();
    }}>
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M8 25v8h24v-8M20 27V7m-7 7 7-7 7 7" />
    </svg>
    <strong>{t.labels.selectImages}</strong>
    <span class="image-drop-area__hint">{dragging && !disabled ? t.input.release : t.input.idle}</span>
    <input type="file" multiple accept="image/*,.heic,.heif,.avif" disabled={disabled} onChange={onChange}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); }
      }} />
  </label>;
}
