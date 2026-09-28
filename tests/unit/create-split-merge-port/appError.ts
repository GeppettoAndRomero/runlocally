export class AppError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = 'AppError';
    this.code = code;
  }
}
