import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const loadPackage = createRequire(import.meta.url);
let sharp;
try {
  const metadata = loadPackage('sharp/package.json');
  if (metadata.version !== '0.33.5') throw new Error(`Expected sharp 0.33.5, found ${metadata.version}`);
  sharp = (await import('sharp')).default;
} catch (error) {
  throw new Error(`Icon generation requires installed sharp 0.33.5: ${error.message}`);
}
const svg = await readFile(resolve('public/icons/app.svg'));
for (const size of [192, 512]) {
  await writeFile(resolve(`public/icons/app-${size}.png`), await sharp(svg).resize(size, size).png().toBuffer());
}
