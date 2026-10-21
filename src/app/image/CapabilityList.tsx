import { useEffect, useState } from 'preact/hooks';
import type { Locale } from '../../i18n/locales';
import { imageCapabilityContent } from '../../i18n/image-capability';
import { NATIVE_IMAGE_FORMATS, probeImageCapabilities, type ImageCapabilities } from '../../engine/image/probe';
import './capability-list.css';

export function CapabilityList({ locale, probe = probeImageCapabilities }: {
  locale: Locale; probe?: () => Promise<ImageCapabilities>;
}) {
  const t = imageCapabilityContent(locale);
  const [result, setResult] = useState<ImageCapabilities>();
  useEffect(() => {
    let mounted = true;
    void probe().then(value => { if (mounted) setResult(value); });
    return () => { mounted = false; };
  }, [probe]);
  return <section class="image-capability">
    <h2>{t.heading}</h2>
    <dl>{NATIVE_IMAGE_FORMATS.map(format => <div key={format} data-format={format}>
      <dt>{t.formats[format]}</dt>
      <dd data-state={result ? result[format] ? 'readable' : 'unreadable' : 'checking'}>
        <span class="capability-reserve" aria-hidden="true">
          <span>{t.checking}</span><span>✓ {t.readable}</span><span>× {t.unreadable}</span>
        </span>
        <span class="capability-value">{!result ? t.checking : result[format]
          ? <>✓ {t.readable}</> : <s>× {t.unreadable}</s>}</span>
      </dd>
    </div>)}<div class="capability-heic"><dt>{t.heic}</dt><dd>{t.fallback}</dd></div></dl>
    <p>{t.note}</p>
  </section>;
}
