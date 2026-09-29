import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import pwa from '@vite-pwa/astro';
import { transformPrecache } from './scripts/pwa-manifest.mjs';
import { buildMetaIntegration } from './scripts/build-meta.mjs';

const pwaOptions = {
  outDir: 'dist',
  strategies: 'generateSW', injectRegister: false, registerType: 'prompt',
  manifest: false, includeAssets: [],
  workbox: {
    sourcemap: process.env.NOTICE_ANALYZE === '1',
    inlineWorkboxRuntime: true, cleanupOutdatedCaches: true, skipWaiting: false,
    navigateFallback: null, globPatterns: ['**/*.{html,js,css,wasm,webmanifest,png,svg}', 'vendor/**', 'SECURITY.md'],
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    manifestTransforms: [entries => transformPrecache(entries)],
  },
};
const pwaOutput = { name: 'pwa-output', hooks: { 'astro:config:setup': ({ config }) => {
  pwaOptions.outDir = fileURLToPath(config.outDir);
} } };
import { DEFAULT_LOCALE, LOCALES } from './src/i18n/locales.ts';
import { isPublicPageUrl, sitemapI18n, SITE_ORIGIN } from './src/seo/page.ts';
import { libarchiveVendorPlugin } from './scripts/libarchive-vendor-plugin.mjs';

export default defineConfig({
  ...(process.env.NOTICE_ANALYZE === '1' ? {
    outDir: '.notice-build',
  } : {}),
  site: SITE_ORIGIN,
  integrations: [preact(), sitemap({ filter: isPublicPageUrl, i18n: sitemapI18n }), pwaOutput, pwa(pwaOptions), buildMetaIntegration()],
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
