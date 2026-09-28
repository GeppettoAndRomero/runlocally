import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import { DEFAULT_LOCALE, LOCALES } from './src/i18n/locales.ts';
import { libarchiveVendorPlugin } from './scripts/libarchive-vendor-plugin.mjs';

export default defineConfig({
  ...(process.env.NOTICE_ANALYZE === '1' ? {
    outDir: '.notice-build',
  } : {}),
  integrations: [preact()],
  vite: {
    ...(process.env.NOTICE_ANALYZE === '1' ? { build: { sourcemap: true } } : {}),
    plugins: [libarchiveVendorPlugin()],
  },
  output: 'static',
  build: { assets: '_astro' },
  compressHTML: true,
  i18n: {
    defaultLocale: DEFAULT_LOCALE,
    locales: [...LOCALES],
    routing: { prefixDefaultLocale: false },
  },
});
