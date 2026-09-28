/** Local error code used by the old filename repair engine. */
export class AppError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'AppError';
    this.code = code;
  }
}
