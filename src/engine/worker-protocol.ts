import { transferHandlers } from 'comlink';
import { EngineError, type EngineErrorCode } from './errors';

const codes: ReadonlySet<string> = new Set<EngineErrorCode>([
  'wrong-password', 'not-encrypted', 'encrypted-entry',
  'bad-central', 'too-large', 'unsupported',
]);

/** Only code, message, name and stack cross the boundary. Arbitrary causes do not. */
export function registerEngineErrorTransfer(): void {
  const original = transferHandlers.get('throw');
  if (!original || (original as typeof original & { engineErrorWrapped?: boolean }).engineErrorWrapped) return;
  const wrapped: typeof original & { engineErrorWrapped?: boolean } = {
    engineErrorWrapped: true,
    canHandle: (value): value is unknown => original.canHandle(value),
    serialize(value) {
      const thrown = (value as { value: unknown }).value;
      if (thrown instanceof EngineError) {
        return [{ isEngineError: true, code: thrown.code, message: thrown.message,
          name: thrown.name, stack: thrown.stack }, []];
      }
      return original.serialize(value);
    },
    deserialize(value) {
      const data = value as { isEngineError?: boolean; code?: string; message?: string;
        name?: string; stack?: string };
      if (data?.isEngineError && typeof data.code === 'string' && codes.has(data.code)) {
        const error = new EngineError(data.code as EngineErrorCode, data.message);
        error.name = data.name ?? 'EngineError';
        if (data.stack) error.stack = data.stack;
        throw error;
      }
      return original.deserialize(value);
    },
  };
  transferHandlers.set('throw', wrapped);
}
