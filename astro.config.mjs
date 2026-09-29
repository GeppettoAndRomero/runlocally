import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import { DEFAULT_LOCALE, LOCALES } from './src/i18n/locales.ts';
import { isPublicPageUrl, sitemapI18n, SITE_ORIGIN } from './src/seo/page.ts';
import { libarchiveVendorPlugin } from './scripts/libarchive-vendor-plugin.mjs';

export default defineConfig({
  ...(process.env.NOTICE_ANALYZE === '1' ? {
    outDir: '.notice-build',
  } : {}),
  site: SITE_ORIGIN,
  integrations: [preact(), sitemap({ filter: isPublicPageUrl, i18n: sitemapI18n })],
  vite: {
    ...(process.env.NOTICE_ANALYZE === '1' ? { build: { sourcemap: true } } : {}),
    plugins: [libarchiveVendorPlugin()],
  },
  output: 'static',
  build: { assets: '_astro' },
  compressHTML: true,
  i18n: {
    defaultLocale: DEFAULT_LOCALE,
    locales: LOCALES.map(locale => locale.code),
    routing: { prefixDefaultLocale: false },
  },
});
