import * as net from 'net';
import {
  BodyReader,
  HttpProtocol,
  HTTPReq,
  HTTPRes,
  MaxHeaderLen,
} from './http_protocol';
import { DynBuf } from './dynamic_buffer';
import { HTTPError } from './errors';
// import { logger } from './logger';

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

  buffer: DynBuf;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.reader = null;
    this.ended = false;
    this.err = null;
    this.buffer = new DynBuf(Buffer.alloc(0), 0);

    socket.on('data', (data: Buffer) => {
      console.assert(this.reader);
      // 暂停data事件
      // 在 Node.js 中，当从网络接收数据时，默认行为是不断触发 'data' 事件，每次传递接收到的数据块。这对于高吞吐量或连续的数据流很有用，但如果处理速度跟不上接收速度，可能会导致内存消耗增加或处理延迟。
      // 总之，this.socket.pause(); 是一种控制数据流动性的手段，帮助开发者管理数据处理节奏，确保应用程序的稳定性和响应性。
      this.socket.pause();
      // fulfill the promise of the current read.
      this.buffer.push(data);
      this.reader.resolve(data);
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
      // 恢复data事件
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

  readerFromReq(req: HTTPReq): BodyReader {
    let bodyLen = -1;
    const contentLen = req.headers.get('Content-Length');
    if (contentLen) {
      // bodyLen = parseDec(contentLen.toString('latin1'));
      bodyLen = Number.parseInt(contentLen.toString('latin1'));
      // logger.info('bodyLen: %s %d', contentLen.toString(), bodyLen);
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
      return this.readerFromContentLength(bodyLen);
    } else if (chunked) {
      // chunked encoding
      throw new HTTPError(501, 'TODO');
    } else {
      // read the rest of the connection
      throw new HTTPError(501, 'TODO');
    }
  }

  readerFromContentLength(remain: number): BodyReader {
    return {
      length: remain,
      read: async (): Promise<Buffer> => {
        if (remain === 0) {
          return Buffer.from(''); // done
        }
        if (this.buffer.length === 0) {
          // try to get some data if there is none
          const data = await this.read();
          if (data.length === 0) {
            // expect more data!
            throw new Error('Unexpected EOF from HTTP body');
          }
        }
        // consume data from the buffer
        const consume = Math.min(this.buffer.length, remain);
        remain -= consume;
        const data = Buffer.from(this.buffer.data.subarray(0, consume));
        this.buffer.pop(consume);
        return data;
      },
    };
  }

  // 复制一份报文数据，因为它将从缓冲区中删除。
  cutMessage(): HTTPReq {
    // messages are separated by '\n'
    const idx = this.buffer.data
      .subarray(0, this.buffer.length)
      .indexOf('\r\n\r\n');
    if (idx < 0) {
      if (this.buffer.length >= MaxHeaderLen) {
        throw new HTTPError(413, 'header is too large');
      }
      return null; // not complete
    }
    // make a copy of the message and move the remaining data to the front
    const msg = HttpProtocol.parseHTTPReq(
      this.buffer.data.subarray(0, idx + 4)
    );
    this.buffer.pop(idx + 4);
    return msg;
  }
}
