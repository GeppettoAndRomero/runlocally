import { describe, expect, it } from 'vitest';
import { hashesFromHtml } from '../../scripts/gen-headers.mjs';
import { insertBuildMeta } from '../../scripts/build-meta.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const html = '<!doctype html><html><head><link rel="canonical" href="/"><script> run(); </script><script type="application/ld+json">{"x":1}</script></head><body>é</body></html>';
const tag = `<meta name="build" content="${sha}">`;

describe('build meta insertion', () => {
  it('adds one tag in head and preserves every other byte and script hash', () => {
    const output = insertBuildMeta(html, sha);
    expect(output).toBe(html.replace('<head>', `<head>${tag}`));
    expect(output.split(tag)).toHaveLength(2);
    expect(hashesFromHtml(output)).toEqual(hashesFromHtml(html));
    expect(insertBuildMeta(output, other)).toBe(output.replace(sha, other));
    expect(insertBuildMeta(output, sha)).toBe(output);
  });

  it('rejects missing head, duplicate tags, out of head tags and invalid values', () => {
    expect(() => insertBuildMeta('<html></html>', sha)).toThrow('head');
    expect(() => insertBuildMeta(`${html}${tag}`, sha)).toThrow('outside head');
    expect(() => insertBuildMeta(html.replace('<head>', `<head>${tag}${tag}`), sha)).toThrow('Duplicate');
    expect(() => insertBuildMeta(html.replace('<head>', `<head>${tag}<meta name=build content="${sha}">`), sha)).toThrow('Duplicate');
    expect(() => insertBuildMeta(html, 'bad')).toThrow('Invalid commit SHA');
    expect(() => insertBuildMeta(html.replace('<head>', '<head><meta name="build" content="bad">'), sha)).toThrow('Invalid existing');
  });
});
