import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const expectedManifest = {
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  lang: 'ja',
  name: 'runlocally',
  short_name: 'runlocally',
  description: 'ファイルを送信せず、ブラウザ内でファイルを扱うツールサイトです。',
  theme_color: '#4f46e5',
  background_color: '#ffffff',
  icons: [
    { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};

describe('PWA launch manifest', () => {
  for (const path of ['public/manifest.webmanifest', 'dist/manifest.webmanifest']) {
    it(`${path} matches the published manifest`, () => {
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      expect(manifest).toEqual(expectedManifest);
    });
  }
});
