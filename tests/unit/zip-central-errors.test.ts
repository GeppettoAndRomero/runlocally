import { ERR_CENTRAL_DIRECTORY_NOT_FOUND, ERR_ENCRYPTED_CENTRAL_DIRECTORY } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { EngineError } from '@/engine/errors';
import { readCentralEntries } from '@/engine/zip/list';

// readCentralEntries only needs getEntries(), so a stub reader isolates the error mapping.
const failing = (message: string) =>
  ({ getEntries: async () => { throw new Error(message); } }) as unknown as Parameters<typeof readCentralEntries>[0];

describe('readCentralEntries error mapping', () => {
  it('maps a damaged central directory to bad-central', async () => {
    const error = await readCentralEntries(failing(ERR_CENTRAL_DIRECTORY_NOT_FOUND)).catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe('bad-central');
  });

  it('maps an encrypted central directory to unsupported, not bad-central', async () => {
    const error = await readCentralEntries(failing(ERR_ENCRYPTED_CENTRAL_DIRECTORY)).catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe('unsupported');
    expect(error.cause).toBeInstanceOf(Error);
  });
});
