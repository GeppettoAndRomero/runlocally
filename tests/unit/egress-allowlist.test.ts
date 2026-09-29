import { describe, expect, it } from 'vitest';
import { allowedUrl } from '../../scripts/check-egress.mjs';
import { readFileSync } from 'node:fs';

describe('static URL allowlist', () => {
  it('accepts only scoped public URLs and exact namespace literals', () => {
    const repository = new URL(JSON.parse(readFileSync('package.json', 'utf8')).repository);
    const accountPath = repository.pathname.split('/').slice(0, 2).join('/');
    expect(allowedUrl(`${repository.origin}${accountPath}/project`)).toBeNull();
    expect(allowedUrl(`${repository.origin}${accountPath}-other`)).not.toBeNull();
    expect(allowedUrl('https://schema.org/Thing')).toBeNull();
    expect(allowedUrl('https://runlocally.app/zip-viewer/')).toBeNull();
    expect(allowedUrl('http://www.w3.org/2000/svg')).toBeNull();
    expect(allowedUrl('https://bit.ly/wb-precache')).toBeNull();
    for (const url of ['https://schema.org.evil.test/', 'https://user@schema.org/',
      'https://runlocally.app.evil.test/', 'https://schema.org/?q=1',
      'https://schema.org/#detail', 'https://schema.org:bad/',
      'https://bit.ly/wb-precache/more', 'https://example.test/']) {
      expect(allowedUrl(url), url).not.toBeNull();
    }
  });
});
