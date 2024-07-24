import { HTTPError, StatusCode } from './errors';
import { logger } from './logger';

// 理论上，报头的大小没有限制，但实际上是有限制的。因为我们要在内存中解析和存储报头，而内存是有限的。
export const MaxHeaderLen = 1024 * 8;

export class Headers {
  headers: Buffer[]; // 并不能保证 URI 和标头字段必须是 ASCII 或 UTF-8 字符串, 所以用buffer 而不是 string
  constructor(headers: Buffer[]) {
    this.headers = headers;
  }

  push(buf: Buffer) {
    this.headers.push(buf);
  }

  get(name: string): Buffer {
    for (const h of this.headers) {
      const [n, v] = this.splitHeader(h);
      if (n.toString().toLowerCase() === name.toLowerCase()) {
        return v;
      }
    }
    return null;
  }
  private splitHeader(h: Buffer): [Buffer, Buffer] {
    //
    const i = h.indexOf(':');
    if (i === -1) {
      throw new HTTPError(400, 'bad header');
    }
    return [h.subarray(0, i), h.subarray(i + 1)];
  }
}

export class HTTPReq {
  method: string;
  uri: Buffer;
  version: string;
  headers: Headers;
}

// an HTTP response
export class HTTPRes {
  code: StatusCode;
  headers: Headers;
  body: BodyReader;

  encodeHTTPResp(): Buffer {
    let buf = Buffer.from(`HTTP/1.1 ${this.code} OK\r\n`);
    for (const header of this.headers.headers) {
      buf = Buffer.concat([buf, header, Buffer.from('\r\n')]);
    }
    buf = Buffer.concat([buf, Buffer.from('Content-Type: text/plain\r\n')]);
    return Buffer.concat([buf, Buffer.from('\r\n')]);
  }

  constructor(code: StatusCode, headers: Headers, body: BodyReader) {
    this.code = code;
    this.headers = headers;
    this.body = body;
  }
}

// an interface for reading/writing data from/to the HTTP body.
export interface BodyReader {
  // the "Content-Length", -1 if unknown.
  length: number;
  // read data. returns an empty buffer after EOF.
  read(): Promise<Buffer>;
  // optional cleanups
  close?: () => Promise<void>;
}

export class HttpProtocol {
  static parseHTTPReq(buf: Buffer): HTTPReq {
    const lines: Buffer[] = this.splitLines(buf);
    // the first line is `METHOD URI VERSION`
    const [method, uri, version] = this.parseRequestLine(lines[0]);
    logger.info(`method=${method}, uri=${uri.toString()}, version=${version}`);
    // followed by header fields in the format of `Name: value`
    const headers: Buffer[] = [];
    for (let i = 1; i < lines.length - 1; i++) {
      const h = Buffer.from(lines[i]); // copy
      if (!this.validateHeader(h)) {
        throw new HTTPError(400, 'bad field');
      }
      headers.push(h);
    }
    // the header ends by an empty line
    console.assert(lines[lines.length - 1].length === 0);
    return {
      method: method,
      uri: uri,
      version: version,
      headers: new Headers(headers),
    };
  }

  /**
   * Splits a given `Buffer` into an array of `Buffer` objects, each representing a single line,
   * based on the occurrence of `\r\n` (carriage return followed by line feed) sequences.
   *
   * @param buf - The input `Buffer` containing the data to be split.
   * @returns An array of `Buffer` instances, where each buffer represents a line from the input.
   */
  private static splitLines(buf: Buffer): Buffer[] {
    // Initialize an empty array to hold the resulting line buffers
    const lines: Buffer[] = [];

    // Iterate over the buffer, keeping track of the current line start index
    let lineStart = 0;

    for (let i = 0; i < buf.length; i++) {
      // Check if the current byte is a carriage return (\r) followed by a line feed (\n)
      if (i + 1 < buf.length && buf[i] === 0x0d && buf[i + 1] === 0x0a) {
        // Extract the current line as a new Buffer object and add it to the lines array
        lines.push(buf.subarray(lineStart, i));

        // Move the line start index to the next position after the \r\n sequence
        i++; // Skip the line feed character
        lineStart = i + 1;
      }
    }

    // Add the remaining content (if any) as the last line
    if (lineStart < buf.length) {
      lines.push(buf.subarray(lineStart));
    }

    return lines;
  }

  private static parseRequestLine(buffer: Buffer): [string, Buffer, string] {
    let i = buffer.indexOf(Buffer.from(' '));
    const method = buffer.subarray(0, i).toString();
    let j = buffer.indexOf(Buffer.from(' '), i + 1);
    const uri = buffer.subarray(i + 1, j);
    const version = buffer
      .subarray(j + 1)
      .toString()
      .split('/')[1];
    return [method, uri, version];
  }

  private static validateHeader(h: Buffer) {
    // return h.length > 0;
    return true;
  }
}
