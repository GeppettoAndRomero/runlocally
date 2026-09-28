import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recoverZip, baseName } from '@/engine/recover/recoverEngine';
import { scanLocalHeaders } from '@/engine/recover/zipScan';
import { buildStoredZip } from './_zipBuilder';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../fixtures/zip/recover/${name}`, import.meta.url))));

const dec = new TextDecoder();
const HELLO = 'Hello, world! This line repeats so DEFLATE has something to chew on.\n'.repeat(40);

describe('recoverZip — normal path (central directory)', () => {
  it('lists and recovers every file from a healthy archive', async () => {
    const res = await recoverZip(fixture('good.zip'));
    expect(res.source).toBe('central');
    expect(res.total).toBe(3);
    expect(res.recovered).toBe(3);
    const names = res.entries.map((e) => e.name).sort();
    expect(names).toEqual(['data.csv', 'hello.txt', 'notes/todo.md']);
    const hello = res.entries.find((e) => e.name === 'hello.txt')!;
    expect(hello.status).toBe('ok');
    expect(dec.decode(hello.bytes!)).toBe(HELLO);
  });
});

describe('recoverZip — a damaged entry is flagged but still downloadable', () => {
  it('flags the entry with a bad checksum as broken, keeps the rest OK', async () => {
    const res = await recoverZip(fixture('crc-broken.zip'));
    expect(res.source).toBe('central');
    expect(res.total).toBe(3);

    const broken = res.entries.find((e) => e.name === 'broken.txt')!;
    expect(broken.status).toBe('broken');
    // Still downloadable: its bytes were salvaged from the local header.
    expect(broken.bytes).not.toBeNull();
    expect(broken.size).toBeGreaterThan(0);

    // The untouched entries are fine.
    expect(res.entries.find((e) => e.name === 'intact.txt')!.status).toBe('ok');
    expect(res.entries.find((e) => e.name === 'also-ok.csv')!.status).toBe('ok');
    expect(res.recovered).toBe(2);
  });

  it('a STORED entry with a bad checksum is broken but fully downloadable', async () => {
    const zip = buildStoredZip([
      { name: 'good.txt', data: 'this one is fine' },
      { name: 'bad.txt', data: 'flip a byte in here somewhere' },
    ]);
    // Corrupt one data byte of the second entry (central dir CRC stays original).
    const scanned = scanLocalHeaders(zip);
    const bad = scanned.find((e) => e.name === 'bad.txt')!;
    zip[bad.dataStart + 3] ^= 0xff;

    const res = await recoverZip(zip);
    const badEntry = res.entries.find((e) => e.name === 'bad.txt')!;
    expect(badEntry.status).toBe('broken');
    expect(badEntry.reason).toBe('crc');
    expect(badEntry.bytes).not.toBeNull();
    // STORED data is fully present even though the checksum no longer matches.
    expect(badEntry.size).toBe('flip a byte in here somewhere'.length);
    expect(res.entries.find((e) => e.name === 'good.txt')!.status).toBe('ok');
  });
});

describe('recoverZip — recovery path (central directory unreadable)', () => {
  it('salvages entries by scanning local headers', async () => {
    const res = await recoverZip(fixture('bad-central.zip'));
    expect(res.source).toBe('scan');
    expect(res.entries.length).toBeGreaterThan(0);
    const names = res.entries.map((e) => e.name);
    expect(names).toContain('hello.txt');
    // The intact local entries decode cleanly even without the index.
    expect(res.recovered).toBeGreaterThan(0);
    const hello = res.entries.find((e) => e.name === 'hello.txt');
    if (hello && hello.status === 'ok') {
      expect(dec.decode(hello.bytes!)).toBe(HELLO);
    }
  });

  it('recovers a hand-built archive whose index was cut off', async () => {
    const zip = buildStoredZip([
      { name: 'keep-1.txt', data: 'first file survives' },
      { name: 'keep-2.txt', data: 'second file survives' },
    ]);
    // Drop everything from the central directory onward.
    let cd = -1;
    for (let i = 0; i + 4 <= zip.length; i++) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02) {
        cd = i;
        break;
      }
    }
    const res = await recoverZip(zip.slice(0, cd));
    expect(res.source).toBe('scan');
    expect(res.total).toBe(2);
    expect(res.recovered).toBe(2);
    expect(dec.decode(res.entries.find((e) => e.name === 'keep-1.txt')!.bytes!)).toBe(
      'first file survives'
    );
  });
});

describe('recoverZip — nothing recoverable', () => {
  it('returns an empty list for bytes with no ZIP structure', async () => {
    const res = await recoverZip(new Uint8Array(64)); // all zeros, no PK signatures
    expect(res.entries).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.recovered).toBe(0);
  });

  it('returns an empty list for random non-zip bytes', async () => {
    const junk = new TextEncoder().encode('this is definitely not a zip archive at all');
    const res = await recoverZip(junk);
    expect(res.entries).toEqual([]);
  });
});

describe('baseName', () => {
  it('takes the last path segment', () => {
    expect(baseName('a/b/c.txt')).toBe('c.txt');
    expect(baseName('flat.txt')).toBe('flat.txt');
    expect(baseName('windows\\path\\file.dat')).toBe('file.dat');
  });

  it('handles directory-like and empty names', () => {
    expect(baseName('folder/')).toBe('folder');
    expect(baseName('')).toBe('recovered-file');
  });
});
