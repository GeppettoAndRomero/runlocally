import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// @ts-expect-error The runtime package is installed without declaration files.
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';
import { chromeUi } from '../../src/i18n/ui';
import { SITE_PAGES, pagePath } from '../../src/seo/url-model';
import { SITE_NAME, SITE_ORIGIN } from '../../src/seo/page';

const image = `${SITE_ORIGIN}/icons/social-card.png`;
for (const { code } of LOCALES) for (const page of SITE_PAGES) {
  test(`${code}/${page} serves one complete same-origin social image`, () => {
    const html = readFileSync(join('dist', pagePath(code, page), 'index.html'), 'utf8');
    const document: Document = new JSDOM(html).window.document;
    const expected = {
      'og:image': image, 'og:image:width': '1200', 'og:image:height': '630',
      'og:image:alt': `${SITE_NAME} — ${chromeUi[code].home}`,
      'twitter:card': 'summary_large_image', 'twitter:image': image,
      'twitter:image:alt': `${SITE_NAME} — ${chromeUi[code].home}`,
    };
    for (const [key, value] of Object.entries(expected)) {
      const attribute = key.startsWith('og:') ? 'property' : 'name';
      const nodes = document.head.querySelectorAll(`meta[${attribute}="${key}"]`);
      expect(nodes, key).toHaveLength(1);
      expect(nodes[0].getAttribute('content'), key).toBe(value);
    }
    const canonical = document.querySelector('link[rel="canonical"]')!.getAttribute('href')!;
    expect(new URL(image).origin).toBe(new URL(canonical).origin);
  });
}

test('the delivered PNG is 1200×630, below 60 KB and matches the font-free source', async () => {
  const sharp = createRequire(import.meta.url)('sharp');
  expect(sharp.versions.sharp).toBe('0.33.5');
  const png = readFileSync('public/icons/social-card.png');
  const metadata = await sharp(png).metadata();
  expect(metadata).toMatchObject({ format: 'png', width: 1200, height: 630 });
  expect(png.length).toBeLessThanOrEqual(60_000);
  expect(readFileSync('dist/icons/social-card.png')).toEqual(png);
  const svg = readFileSync('public/icons/social-card.svg', 'utf8');
  expect(svg).not.toMatch(/<(?:text|image|foreignObject|script)\b|\b(?:href|src)\s*=|url\s*\(|@import|@font-face|<!DOCTYPE|<!ENTITY/i);
  expect(png).toEqual(await sharp(Buffer.from(svg)).resize(1200, 630).png().toBuffer());
  const sw = readFileSync('dist/sw.js', 'utf8');
  for (const extension of ['png', 'svg']) expect(sw).toContain(`icons/social-card.${extension}`);
  const docs = readFileSync('docs/PWA.md', 'utf8');
  expect(docs).toContain(`${statSync('public/icons/social-card.png').size.toLocaleString('en-US')} bytes`);
});
