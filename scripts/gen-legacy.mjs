import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const middlewarePath = join(root, 'functions/_middleware.js');
const start = '// BEGIN GENERATED LEGACY TABLES';
const end = '// END GENERATED LEGACY TABLES';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const toolPrefix = 'zip';

function validate(slugs) {
  if (!Array.isArray(slugs)) throw new Error('Invalid input list');
  const seen = new Set();
  for (const slug of slugs) {
    if (typeof slug !== 'string' || !slugPattern.test(slug) || seen.has(slug) || slug === toolPrefix) {
      throw new Error('Invalid or duplicate legacy slug');
    }
    seen.add(slug);
  }
}

function render(slugs) {
  validate(slugs);
  const legacy = [...slugs].sort();
  return `${start}\nconst LEGACY_SLUGS = ${JSON.stringify(legacy, null, 2)};\n${end}`;
}

function replaceTable(source, table) {
  const first = source.indexOf(start);
  const last = source.indexOf(end);
  if (first < 0 || last <= first || source.indexOf(start, first + 1) !== -1 ||
      source.indexOf(end, last + 1) !== -1) throw new Error('Missing or duplicate generated markers');
  return source.slice(0, first) + table + source.slice(last + end.length);
}

async function main() {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check')) {
    throw new Error('Usage: node scripts/gen-legacy.mjs [--check]');
  }
  const slugs = JSON.parse(await readFile(join(root, 'legacy/slugs.json'), 'utf8'));
  const table = render(slugs);
  const source = await readFile(middlewarePath, 'utf8');
  const expected = replaceTable(source, table);
  if (process.argv[2] === '--check') {
    if (source !== expected) throw new Error('Generated legacy tables are stale');
  } else if (source !== expected) {
    await writeFile(middlewarePath, expected);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
