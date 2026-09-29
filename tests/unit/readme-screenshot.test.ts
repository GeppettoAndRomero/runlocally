import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The README shows one real screen capture in both languages. Keep the image and both references in place.
const root = process.cwd();
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const image = 'docs/images/screenshot.png';

describe('README screenshot', () => {
  it('is a PNG that exists in the repository', () => {
    expect(existsSync(join(root, image))).toBe(true);
    const bytes = readFileSync(join(root, image));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.length).toBeGreaterThan(10_000);
  });
  it('is shown once in each language with a description', () => {
    const references = [...readme.matchAll(/!\[([^\]]+)\]\(docs\/images\/screenshot\.png\)/g)];
    expect(references).toHaveLength(2);
    for (const reference of references) expect(reference[1].length).toBeGreaterThan(10);
    expect(readme).not.toMatch(/掲載予定|will be added here/);
  });
});
