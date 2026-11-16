import { expect, it } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { expose, type Endpoint } from 'comlink';
import { BlobReader, configure, TextWriter, ZipReader } from '@zip.js/zip.js';
import { listEntries } from '../../src/engine/zip/list';
import { getNameCandidates } from '../../src/engine/zip/names';
import { rewriteZip } from '../../src/engine/zip/rewrite';
import { crc32 } from '../../src/engine/recover/crc32';
import { workerApi } from '../../src/engine/worker-api';
import { __createZipEngineForEndpoint } from '../../src/app/engine';
import { makeNameZip, nameCases } from '../fixtures/zip/names/fixtures';
configure({ useWebWorkers: false });
const raw = new Uint8Array(nameCases[0].bytes);
function unicodePath(name: string) {
  const utf8 = new TextEncoder().encode(name), payload = new Uint8Array(5 + utf8.length);
  payload[0] = 1;
  new DataView(payload.buffer).setUint32(1, crc32(raw), true);
  payload.set(utf8, 5);
  return payload;
}
it('checks the independent CRC32 vector', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});
it.each(['plain', 'bit11', 'unicode', 'crc', 'version', 'short', 'conflict'] as const)('lists real ZIP provenance: %s', async mode => {
  let payload = unicodePath('選択.txt');
  if (mode === 'crc') payload[1] ^= 1;
  if (mode === 'version') payload[0] = 2;
  if (mode === 'short') payload = new Uint8Array([1, 0, 0, 0]);
  const file = await makeNameZip(raw, { utf8: mode === 'bit11' || mode === 'conflict',
    ...(mode === 'plain' || mode === 'bit11' ? {} : { unicodePath: payload }) });
  const [entry] = await listEntries(file);
  expect(entry.rawFilename).toEqual(raw);
  const result = getNameCandidates(entry);
  if (mode === 'unicode' || mode === 'bit11' || mode === 'conflict') {
    expect(entry.utf8).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.candidates.every(c => c.sources.every(s => s.encoding === 'original'))).toBe(true);
    if (mode === 'unicode') expect(entry.name).toBe('選択.txt');
    else expect(entry.name).toContain('\ufffd'); // zip.js intentionally decodes non-fatally.
  } else {
    expect(entry.utf8).toBe(false);
    expect(result.candidates.find(c => c.name === nameCases[0].name)?.sources).toContainEqual({ encoding: 'shift_jis', normalization: 'none' });
  }
});
it('honors inferred UTF-8 without bit 11 and explicit directories', async () => {
  const file = await makeNameZip(new TextEncoder().encode('か\u3099/'), { directory: true });
  const [entry] = await listEntries(file);
  expect(entry).toMatchObject({ name: 'か\u3099/', directory: true, utf8: true });
  expect(getNameCandidates(entry).candidates.map(c => c.name)).toEqual(['か\u3099/', 'が/']);
});
it.each([false, true])('rewrites only the preview selection, through proxy=%s, preserving input and content', async remote => {
  const { port1, port2 } = new MessageChannel();
  expose(workerApi, port2 as unknown as Endpoint);
  const endpoint = Object.assign(port1, { terminate: () => { port1.close(); port2.close(); } });
  const client = __createZipEngineForEndpoint(endpoint as never, new EventTarget() as never);
  try {
    const file = await makeNameZip(raw), before = new Uint8Array(await file.arrayBuffer());
    const listing = remote ? await client.listEntries(file) : await listEntries(file);
    const candidates = getNameCandidates(listing[0]).candidates;
    // Keep the selected output by source order, including a return to the original source.
    for (const selected of [candidates.find(c => c.name === nameCases[0].name)!, candidates.find(c => c.sources.some(s => s.encoding === 'original'))!]) {
      const selection = [selected.name];
      let index = 0;
      const rename = (_name: string) => selection[index++];
      const out = remote ? await client.rewriteZip(file, { rename }) : await rewriteZip(file, { rename });
      expect(index).toBe(1);
      const reader = new ZipReader(new BlobReader(out.blob));
      try {
        const [written] = await reader.getEntries();
        if (!written || written.directory) throw new Error('Expected a file entry');
        expect(written.filename).toBe(selected.name);
        expect(written.filenameUTF8).toBe(true);
        expect(await written.getData(new TextWriter())).toBe('filename fixture content');
      } finally { await reader.close(); }
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(before);
    }
  } finally { client.terminate(); port1.close(); port2.close(); }
});
