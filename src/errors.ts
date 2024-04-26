export type StatusCode = 200 | 400 | 404 | 413 | 500 | 501;

export class HTTPError extends Error {
  code: StatusCode;
  message: string;

  constructor(code: StatusCode, message: string) {
    super();
    this.code = code;
    this.message = message;
  }
}
