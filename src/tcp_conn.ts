import * as net from 'net';
import { BodyReader, HTTPReq, HTTPRes } from './http_protocol';
import { DynBuf } from './dynamic_buffer';
import { HTTPError } from './errors';

export interface Reader {
  resolve: (value: Buffer) => void;
  reject: (reason: Error) => void;
}

export class TCPConn {
  socket: net.Socket;
  reader: Reader;
  // from the 'error' event
  err: Error;
  // EOF, from the 'end' event
  ended: boolean;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.reader = null;
    this.ended = false;
    this.err = null;

    socket.on('data', (data: Buffer) => {
      console.assert(this.reader);
      // pause the 'data' event until the next read.
      this.socket.pause();
      // fulfill the promise of the current read.
      this.reader!.resolve(data);
      this.reader = null;
    });
    socket.on('end', () => {
      // this also fulfills the current read.
      this.ended = true;
      if (this.reader) {
        this.reader.resolve(Buffer.from('')); // EOF
        this.reader = null;
      }
    });
    socket.on('error', (err: Error) => {
      // errors are also delivered to the current read.
      this.err = err;
      if (this.reader) {
        this.reader.reject(err);
        this.reader = null;
      }
    });
  }

  read(): Promise<Buffer> {
    console.assert(!this.reader); // no concurrent calls
    return new Promise((resolve, reject) => {
      // if the connection is not readable, complete the promise now.
      if (this.err) {
        reject(this.err);
        return;
      }
      if (this.ended) {
        resolve(Buffer.from('')); // EOF
        return;
      }
      this.reader = { resolve: resolve, reject: reject };
      // and resume the 'data' event to fulfill the promise later.
      this.socket.resume();
    });
  }
  write(data: Buffer): Promise<void> {
    console.assert(data.length > 0);
    return new Promise((resolve, reject) => {
      if (this.err) {
        reject(this.err);
        return;
      }
      // 这边可以先写到内存buffer中
      // 当内存buffer快满了 或者超过多少时间了
      // 再调用flush方法 把内存buffer中的数据写入socket
      // 就像go中的 bufio.Writer
      this.socket.write(data, (err?: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async writeHTTPResp(resp: HTTPRes) {
    if (resp.body.length < 0) {
      throw new Error('TODO: chunked encoding');
    }
    // set the "Content-Length" field
    console.assert(!resp.headers.get('Content-Length'));
    resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`));
    // write the header
    await this.write(resp.encodeHTTPResp());
    // write the body
    while (true) {
      const data = await resp.body.read();
      if (data.length === 0) {
        break;
      }
      await this.write(data);
    }
  }

  readerFromReq(buf: DynBuf, req: HTTPReq): BodyReader {
    let bodyLen = -1;
    const contentLen = req.headers.get('Content-Length');
    if (contentLen) {
      // bodyLen = parseDec(contentLen.toString('latin1'));
      bodyLen = Number.parseInt(contentLen.toString('latin1'));
      // console.log('bodyLen: ', contentLen.toString(), bodyLen);
      if (isNaN(bodyLen)) {
        throw new HTTPError(400, 'bad Content-Length.');
      }
    }

    const bodyAllowed = !(req.method === 'GET' || req.method === 'HEAD');
    const chunked =
      req.headers.get('Transfer-Encoding')?.equals(Buffer.from('chunked')) ||
      false;
    if (!bodyAllowed && (bodyLen > 0 || chunked)) {
      throw new HTTPError(400, 'HTTP body not allowed.');
    }
    if (!bodyAllowed) {
      bodyLen = 0;
    }

    if (bodyLen >= 0) {
      // "Content-Length" is present
      return this.readerFromConnLength(buf, bodyLen);
    } else if (chunked) {
      // chunked encoding
      throw new HTTPError(501, 'TODO');
    } else {
      // read the rest of the connection
      throw new HTTPError(501, 'TODO');
    }
  }

  readerFromConnLength(buf: DynBuf, remain: number): BodyReader {
    return {
      length: remain,
      read: async (): Promise<Buffer> => {
        if (remain === 0) {
          return Buffer.from(''); // done
        }
        if (buf.length === 0) {
          // try to get some data if there is none
          const data = await this.read();
          buf.push(data);
          if (data.length === 0) {
            // expect more data!
            throw new Error('Unexpected EOF from HTTP body');
          }
        }
        // consume data from the buffer
        const consume = Math.min(buf.length, remain);
        remain -= consume;
        const data = Buffer.from(buf.data.subarray(0, consume));
        buf.pop(consume);
        return data;
      },
    };
  }
}
