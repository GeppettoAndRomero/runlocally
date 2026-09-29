import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGLISH_LOCALE } from '../../src/i18n/locales';
import { pageUrl } from '../../src/seo/page';

describe('Page layout rendering', () => {
  it('renders test content through Astro without adding a product route', () => {
    const root = mkdtempSync(join(tmpdir(), 'seo-render-'));
    const repository = process.cwd();
    try {
      mkdirSync(join(root, 'src/pages'), { recursive: true });
      symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
      writeFileSync(join(root, 'astro.config.mjs'),
        "import { defineConfig } from 'astro/config'; export default defineConfig({ site: 'https://runlocally.app' });\n");
      writeFileSync(join(root, 'src/pages/index.astro'), `---
import Page from ${JSON.stringify(join(repository, 'src/layouts/Page.astro'))};
import { ENGLISH_LOCALE } from ${JSON.stringify(join(repository, 'src/i18n/locales.ts'))};
const content = {
  title: 'ZIP viewer', description: 'Inspect an archive.', h1: 'View ZIP contents',
  lead: 'View entries.', steps: [{ heading: 'Browse entries', body: 'Inspect names.' }],
  faq: [], limits: [],
};
---
<Page locale={ENGLISH_LOCALE} page="browse" content={content}><main>Sample</main></Page>
`);
      execFileSync(process.execPath, [join(repository, 'node_modules/astro/astro.js'), 'build'], {
        cwd: root, stdio: 'pipe', timeout: 30_000,
      });
      const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
      const canonical = pageUrl(ENGLISH_LOCALE, 'browse');
      expect(html.match(/<html\b/g)).toHaveLength(1);
      expect(html.match(/<head\b/g)).toHaveLength(1);
      expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
      expect(html).toContain(`property="og:url" content="${canonical}"`);
      expect(html).toContain('property="og:locale" content="en_US"');
      expect(html).toContain('property="og:locale:alternate" content="ja_JP"');
      expect(html).toContain(`hreflang="x-default" href="${canonical}"`);
      expect(html).toContain('<main>Sample</main>');
      const json = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
      expect(json).toBeTruthy();
      const application = JSON.parse(json!);
      expect(application).toMatchObject({
        '@type': 'SoftwareApplication', url: canonical, featureList: ['Browse entries'],
      });
      expect(application).not.toHaveProperty('aggregateRating');
      const colophon = readFileSync('README.md', 'utf8').match(/^Colophon: (.+)$/m)?.[1];
      expect(html.split(colophon!)).toHaveLength(2);
      expect(html).toContain('href="/SECURITY.md"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 35_000);
});
