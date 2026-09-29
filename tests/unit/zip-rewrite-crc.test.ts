import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BlobWriter, configure, TextReader, ZipWriter } from '@zip.js/zip.js';
import { rewriteZip } from '../../src/engine/zip/rewrite';
import { extractAll, extractEntry } from '../../src/engine/zip/extract';
import { listEntries } from '../../src/engine/zip/list';

configure({ useWebWorkers: false });
const fixture = (name: string) => new File(
  [readFileSync(fileURLToPath(new URL(`../fixtures/zip/recover/${name}`, import.meta.url)))], name,
);

describe('rewrite CRC', () => {
  it('rejects removal that retains a broken entry without producing output', async () => {
    const input = fixture('crc-broken.zip');
    const before = new Uint8Array(await input.arrayBuffer());
    await expect(rewriteZip(input, { keep: name => name !== 'also-ok.csv' }))
      .rejects.toMatchObject({ name: 'EngineError', code: 'corrupt-entry' });
    expect(new Uint8Array(await input.arrayBuffer())).toEqual(before);
  });

  it('rejects name repair when the broken entry is kept', async () => {
    await expect(rewriteZip(fixture('crc-broken.zip'), { rename: name => `new-${name}` }))
      .rejects.toMatchObject({ code: 'corrupt-entry' });
  });

  it('can remove the broken entry and preserves both remaining contents', async () => {
    const input = fixture('crc-broken.zip');
    const out = await rewriteZip(input, { keep: name => name !== 'broken.txt' });
    const rewritten = new File([out.blob], 'rewritten.zip');
    expect((await listEntries(rewritten)).map(entry => entry.name)).toEqual(['intact.txt', 'also-ok.csv']);
    for (const name of ['intact.txt', 'also-ok.csv']) {
      expect(await (await extractEntry(rewritten, name)).text()).toBe(await (await extractEntry(input, name)).text());
    }
  });

  it('rewrites a healthy archive with matching file contents', async () => {
    const input = fixture('good.zip');
    const out = await rewriteZip(input);
    const rewritten = new File([out.blob], 'rewritten.zip');
    const original = await extractAll(input);
    const result = await extractAll(rewritten);
    expect(result.map(entry => entry.name)).toEqual(original.map(entry => entry.name));
    for (let index = 0; index < result.length; index++) {
      expect(await result[index].blob.text()).toBe(await original[index].blob.text());
    }
  });

  it('keeps encrypted entry handling unchanged', async () => {
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add('secret.txt', new TextReader('secret'), { password: 'correct', zipCrypto: true });
    const input = new File([await writer.close()], 'encrypted.zip');
    await expect(rewriteZip(input)).rejects.toMatchObject({ code: 'encrypted-entry' });
    await expect(rewriteZip(input, { password: 'wrong' })).rejects.toMatchObject({ code: 'wrong-password' });
    const result = await rewriteZip(input, { password: 'correct' });
    expect((await listEntries(new File([result.blob], 'output.zip'))).map(entry => entry.name)).toEqual(['secret.txt']);
  });
});
