import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint();

it('rejects TSX default parameters and locale attributes', async () => {
  const source = 'export function Probe({ locale = "en" }) { return <div lang="ja" locale="en">{locale}</div>; }';
  const [result] = await eslint.lintText(source, { filePath: 'src/ui/LocaleProbe.tsx' });
  expect(result.errorCount).toBeGreaterThanOrEqual(3);
  expect(result.messages.some(message => message.ruleId === 'no-restricted-syntax')).toBe(true);
});

it('rejects Astro literal attributes and accepts registry references', async () => {
  const bad = '---\n---\n<div lang="ja" locale="en"></div>';
  const [result] = await eslint.lintText(bad, { filePath: 'src/pages/locale-probe.astro' });
  expect(result.errorCount).toBeGreaterThanOrEqual(2);
  const good = '---\nimport { DEFAULT_LOCALE } from "../i18n/locales";\n---\n<div lang={DEFAULT_LOCALE} locale={DEFAULT_LOCALE}></div>';
  const [accepted] = await eslint.lintText(good, { filePath: 'src/pages/locale-probe.astro' });
  expect(accepted.errorCount).toBe(0);
});

it('accepts TSX references', async () => {
  const source = 'import { ENGLISH_LOCALE } from "../i18n/locales"; export function Probe({ locale = ENGLISH_LOCALE }) { return <div lang={locale} />; }';
  const [result] = await eslint.lintText(source, { filePath: 'src/ui/LocaleProbe.tsx' });
  expect(result.errorCount).toBe(0);
});
