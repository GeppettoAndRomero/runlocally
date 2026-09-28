/** Temporary error type retained for the stage A regression tests. */
export class AppError extends Error {
  constructor(public code: string, public params?: Record<string, string | number>) {
    super(code);
    this.name = 'AppError';
  }
}
