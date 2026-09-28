import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import { DEFAULT_LOCALE, LOCALES } from './src/i18n/locales.ts';

export default defineConfig({
  ...(process.env.NOTICE_ANALYZE === '1' ? {
    outDir: '.notice-build',
    vite: { build: { sourcemap: true } },
  } : {}),
  integrations: [preact()],
  output: 'static',
  build: { assets: '_astro' },
  compressHTML: true,
  i18n: {
    defaultLocale: DEFAULT_LOCALE,
    locales: [...LOCALES],
    routing: { prefixDefaultLocale: false },
  },
});
