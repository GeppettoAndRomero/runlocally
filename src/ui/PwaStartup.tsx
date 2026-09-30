import type { Locale } from '../i18n/locales';
import { InstallPrompt } from './InstallPrompt';
import { UpdatePrompt } from './UpdatePrompt';

type Props = { locale: Locale; busy?: boolean; hasWork?: boolean; isSafe?: () => boolean };
const hubIsSafe = () => true;

export function PwaStartup({ locale, busy = false, hasWork = false, isSafe = hubIsSafe }: Props) {
  return <>
    <InstallPrompt locale={locale} />
    <UpdatePrompt locale={locale} busy={busy} hasWork={hasWork} isSafe={isSafe} />
  </>;
}
