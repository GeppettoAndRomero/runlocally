export type EngineErrorCode =
  | 'wrong-password'
  | 'not-encrypted'
  | 'encrypted-entry'
  | 'corrupt-entry'
  | 'bad-central'
  | 'too-large'
  | 'unsupported';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EngineError';
    this.code = code;
  }
}
