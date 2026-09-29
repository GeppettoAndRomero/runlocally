import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const covenant = read('docs/COVENANTS.md');
const principles = read('docs/PRINCIPLES.md');
const readme = read('README.md');
const pwa = read('docs/PWA.md');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

function promises(markdown: string) {
  return [...markdown.matchAll(/^\d\. \*\*(.+?)\*\*\n {3}(.+)$/gm)]
    .map(([, heading, description]) => ({ heading, description }));
}

const citedTests: Record<string, string[]> = {
  'tests/e2e/network.spec.ts': [
    'online operations and observed communication',
    'chromium: offline repeats the same operations',
    'chromium: monitor rejects page and service-worker probes',
  ],
  'tests/e2e/csp.spec.ts': [
    'published operations have no policy violations or reporting injection',
    ...['inline script', 'blob script', 'blob worker', 'external fetch'].map(name => `detector sees browser rejection: ${name}`),
  ],
  'tests/e2e/covenants.spec.ts': ['session URLs and offline operations', 'published pages, manifest and reporting path'],
  'tests/e2e/sw-migration.spec.ts': ['chromium removes old registrations and caches while retaining current operations'],
  'tests/unit/egress-allowlist.test.ts': ['accepts only scoped public URLs and exact namespace literals'],
  'tests/unit/egress-scan.test.ts': ['rejects an empty dist and catches minified JS URLs'],
  'tests/unit/pwa-build.test.ts': ['contains one root worker and manifest with all public pages and matched vendor assets'],
  'tests/unit/pwa-manifest.test.ts': ['uses every public URL and keeps each HTML revision', 'rejects absent pages, duplicates and an incomplete vendor pair'],
  'tests/unit/register-sw.test.ts': [
    'removes prior scope and cache before registering once',
    'holds an update when another tab does not answer',
    'pauses input while applying and defers reload if work starts before controller change',
    'reloads once after a safe controller change',
  ],
  'tests/unit/build-meta-build.test.ts': ['keeps the worker, page revisions, assets and headers stable for a SHA-only change'],
  'tests/unit/check-deployed-build.test.ts': ['accepts one exact head meta with varied attribute syntax'],
};

describe('covenant documentation matches the repository', () => {
  it('quotes each heading and explanation exactly and preserves the README headings', () => {
    const source = promises(principles);
    expect(source).toHaveLength(4);
    expect(promises(covenant)).toEqual(source);
    const japanese = readme.split('## English')[0];
    const headings = [...japanese.matchAll(/^\d\. (.+?) — /gm)].map(match => match[1]);
    expect(headings).toEqual(source.map(item => item.heading));
  });

  it('links both README languages and the PWA page to the covenant document', () => {
    const [japanese, english] = readme.split('## English');
    expect(japanese).toContain('(docs/COVENANTS.md)');
    expect(english).toContain('(docs/COVENANTS.md)');
    expect(pwa).toContain('(COVENANTS.md)');
  });

  it('cites existing files and exact test names', () => {
    for (const path of Object.keys(citedTests)) {
      expect(existsSync(join(root, path)), path).toBe(true);
      expect(covenant, path).toContain(`\`${path}\``);
    }
    for (const path of ['scripts/check-egress.mjs', 'scripts/build-meta.mjs', 'scripts/gen-headers.mjs',
      'scripts/check-deployed-build.mjs', '.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      expect(existsSync(join(root, path)), path).toBe(true);
      expect(covenant, path).toContain(`\`${path}\``);
    }
    for (const [path, names] of Object.entries(citedTests)) for (const name of names) {
      expect(covenant, name).toContain(`\`${name}\``);
      const source = read(path);
      if (name.startsWith('detector sees browser rejection: ')) {
        expect(source).toContain('test(`detector sees browser rejection: ${probe.name}`');
        expect(source).toContain(`name: '${name.slice('detector sees browser rejection: '.length)}'`);
      } else expect(source, `${path}: ${name}`).toContain(`'${name}'`);
    }
  });

  it('matches scripts, CI wiring, selected production smoke and browser limits', () => {
    for (const name of [...covenant.matchAll(/`npm run ([\w:.-]+)`/g)].map(match => match[1])) {
      expect(pkg.scripts[name], name).toBeTruthy();
    }
    expect(pkg.scripts.ci).toContain('npm run check:egress');
    expect(pkg.scripts.ci).toContain('npm run test:unit');
    expect(pkg.scripts.ci).not.toContain('test:e2e');
    expect(read('.github/workflows/ci.yml')).toContain('CI=1 npm run test:e2e');
    const deploy = read('.github/workflows/deploy.yml');
    for (const name of ['covenants', 'network', 'csp']) expect(deploy).toContain(`tests/e2e/${name}.spec.ts`);
    expect(deploy).not.toContain('tests/e2e/sw-migration.spec.ts');
    const config = read('playwright.config.ts');
    for (const name of ['chromium', 'firefox', 'webkit']) expect(config).toContain(`name: '${name}'`);
    expect(config).toContain('wrangler pages dev dist');
    for (const path of ['tests/e2e/covenants.spec.ts', 'tests/e2e/network.spec.ts', 'tests/e2e/csp.spec.ts']) {
      expect(read(path), path).toContain("browserName === 'chromium'");
    }
  });

  it('keeps the explicit limits of automated verification', () => {
    for (const limit of ['実インストール完了', '報告への応答 SLA', '全 CDN 拠点', '既存端末のキャッシュ更新完了', '現時点では未実施']) {
      expect(covenant).toContain(limit);
    }
  });
});
