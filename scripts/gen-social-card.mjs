import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const loadPackage = createRequire(import.meta.url);
const { version } = loadPackage('sharp/package.json');
if (version !== '0.33.5') throw new Error(`Expected sharp 0.33.5, found ${version}`);
const sharp = (await import('sharp')).default;
const svg = await readFile('public/icons/social-card.svg');
await writeFile('public/icons/social-card.png', await sharp(svg).resize(1200, 630).png().toBuffer());
