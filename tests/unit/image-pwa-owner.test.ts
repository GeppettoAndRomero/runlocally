import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('has exactly one PwaStartup owner on the image page', () => {
  // The converter owns its own startup component; the layout must not add a second one.
  const converter = readFileSync('src/app/image/ImageConverter.tsx', 'utf8');
  expect(converter.match(/<PwaStartup\b/g)).toHaveLength(1);
  const layout = readFileSync('src/layouts/Base.astro', 'utf8');
  expect(layout.match(/<PwaStartup\b/g)).toHaveLength(1);
  expect(layout).toMatch(/page === 'hub'[^\n]*PwaStartup|PwaStartup[^\n]*page === 'hub'/);
  expect(layout).not.toMatch(/page === 'image'[^\n]*PwaStartup/);
});
