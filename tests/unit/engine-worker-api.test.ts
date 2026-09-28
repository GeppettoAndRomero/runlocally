import { describe, it, expect } from 'vitest';
import { configure } from '@zip.js/zip.js';
import { workerApi } from '../../src/engine/worker-api';

configure({ useWebWorkers: false });
const file = (name: string, content: string) => new File([content], name);

describe('ZIP worker function table', () => {
  it('exposes only eight ZIP operations', () => {
    expect(Object.keys(workerApi).sort()).toEqual([
      'createZip', 'extractAll', 'extractEntry', 'listEntries', 'mergeZips',
      'recoverZip', 'rewriteZip', 'splitZip',
    ]);
  });
  it('runs each operation on real ZIP data', async () => {
    const created = await workerApi.createZip([{ file: file('a.txt', 'a'), relativePath: 'dir/a.txt' }]);
    const zip = new File([created], 'created.zip');
    expect((await workerApi.listEntries(zip))[0].name).toBe('dir/a.txt');
    expect(await (await workerApi.extractEntry(zip, 'dir/a.txt')).text()).toBe('a');
    expect((await workerApi.extractAll(zip))[0].name).toBe('dir/a.txt');
    expect((await workerApi.rewriteZip(zip)).kept).toBe(1);
    expect(await workerApi.splitZip(zip, 10000)).toHaveLength(1);
    expect((await workerApi.mergeZips([zip, zip], { collision: 'skip' })).stats.skipped).toBe(1);
    expect((await workerApi.recoverZip(await created.arrayBuffer())).total).toBe(1);
  });
});
