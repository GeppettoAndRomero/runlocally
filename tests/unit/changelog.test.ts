import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPS } from '../../src/i18n/ops';

const read = (path: string) => readFileSync(path, 'utf8');
const changelog = read('CHANGELOG.md');
const packageVersion = (JSON.parse(read('package.json')) as { version: string }).version;
const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: { '': { version: string } } };

function firstRelease() {
  const headings = [...changelog.matchAll(/^## (.+)$/gm)];
  expect(headings.length).toBeGreaterThan(0);
  const heading = headings[0];
  const body = changelog.slice(heading.index! + heading[0].length, headings[1]?.index ?? changelog.length);
  return { heading: heading[1], body };
}

function supportedRows(body: string) {
  const section = body.match(/^### 対応\s*\n([\s\S]*?)(?=^### |$(?![\s\S]))/m)?.[1];
  expect(section).toBeDefined();
  const lines = section!.split('\n').map(line => line.trim()).filter(line => line.startsWith('|'));
  expect(lines.length).toBeGreaterThan(2);
  expect(lines[0]).toMatch(/^\|\s*操作 ID\s*\|/);
  expect(lines[1]).toMatch(/^\|(?:\s*:?-+:?\s*\|){2}$/);
  return lines.slice(2).map(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatch(/^`[^`]+`$/);
    return { id: cells[0].slice(1, -1), description: cells[1] };
  });
}

describe('v0.1.0 changelog', () => {
  it('uses a real date and matches both package roots', () => {
    const { heading } = firstRelease();
    const match = heading.match(/^v(\d+\.\d+\.\d+) - (\d{4})-(\d{2})-(\d{2})$/);
    expect(match).not.toBeNull();
    const [, version, year, month, day] = match!;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    expect(date.toISOString().slice(0, 10)).toBe(`${year}-${month}-${day}`);
    expect(version).toBe('0.1.0');
    expect(packageVersion).toBe(version);
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
  });

  it('lists exactly the available operations once in the support table', () => {
    const rows = supportedRows(firstRelease().body);
    const ids = rows.map(row => row.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => OPS.some(op => op.id === id))).toBe(true);
    expect(new Set(ids)).toEqual(new Set(OPS.filter(op => op.available).map(op => op.id)));
  });

  it('ties RAR, 7z, and tar browsing and extraction to archive enabled operations', () => {
    const rows = supportedRows(firstRelease().body);
    for (const id of ['browse', 'extract'] as const) {
      const row = rows.find(entry => entry.id === id);
      expect(row).toBeDefined();
      for (const format of ['RAR', '7z', 'tar']) expect(row!.description).toContain(format);
      const op = OPS.find(entry => entry.id === id);
      expect(op && 'archive' in op && op.archive).toBe(true);
    }
    expect(rows.some(row => row.id === 'rar-7z')).toBe(false);
  });
});
