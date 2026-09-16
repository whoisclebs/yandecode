export class YandeCodeError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.name = 'YandeCodeError';
    this.code = code;
  }
}
