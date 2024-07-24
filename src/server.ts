import * as net from 'net';
import { TCPConn } from './tcp_conn';
import { HTTPReq, HTTPRes, Headers } from './http_protocol';
import { HTTPError } from './errors';
import { handleReq, readerFromMemory } from './handler';
const logger = require('pino')();

export class Server {
  server: net.Server;

  constructor() {
    this.server = net.createServer({
      // 默认情况下，一端发送/收到 EOF 后，会自动关闭链接
      // 如果打开下面的开关，socket.end() 不会再关闭连接，而只会发送 EOF。请使用 socket.destroy() 手动关闭套接字。
      allowHalfOpen: true,
      // 表示是否应在接收连接时暂停套接字。
      pauseOnConnect: true,
      // 禁用  Nagle's 算法
      noDelay: true, // TCP_NODELAY
    });
  }

  listen(PORT: number) {
    this.server.listen({ host: '0.0.0.0', port: PORT }, () => {
      logger.info(`server listening on port: ${PORT}`);
    });

    this.server.on('connection', conn => this.newConn(conn));

    this.server.on('error', (err: Error) => {
      logger.error(err);
      throw err;
    });
  }

  async serveClient(conn: TCPConn): Promise<void> {
    while (true) {
      const msg: HTTPReq = conn.cutMessage();
      if (!msg) {
        // need more data
        const data: Buffer = await conn.read();
        // EOF?
        if (data.length === 0 && conn.buffer.length === 0) {
          // omitted ...
          return;
        }
        if (data.length === 0) {
          throw new HTTPError(400, 'Unexpected EOF.');
        }
        // got some data, try it again.
        continue;
      }

      // 处理请求 返回响应
      // logger.info(`get msg: %o`, msg);
      const reqBody = conn.readerFromReq(msg);
      const res: HTTPRes = await handleReq(msg, reqBody);
      try {
        await conn.writeHTTPResp(res);
      } finally {
        await res.body.close?.();
      }

      // HTTP/1.0 协议的，收到一个消息后，就断开连接。
      if (msg.version === '1.0') {
        return;
      }
      // 确保读取完请求体
      while ((await reqBody.read()).length > 0) {
        /* empty */
      }
    }
  }

  async newConn(socket: net.Socket): Promise<void> {
    logger.info(
      `new connection remoteAddress=${socket.remoteAddress} remotePort=${socket.remotePort}`
    );

    const conn: TCPConn = new TCPConn(socket);

    try {
      await this.serveClient(conn);
    } catch (error) {
      logger.error(error);
      if (error instanceof HTTPError) {
        // intended to send an error response
        const resp = new HTTPRes(
          error.code,
          new Headers([]),
          readerFromMemory(Buffer.from(error.message + '\n'))
        );
        try {
          await conn.writeHTTPResp(resp);
        } catch (exc) {
          /* ignore */
        }
      }
    } finally {
      socket.destroy();
    }
  }
}
