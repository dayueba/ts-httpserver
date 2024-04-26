import * as net from 'net';
import { TCPConn } from './tcp_conn';
import { DynBuf } from './dynamic_buffer';
import { BodyReader, HTTPReq, HTTPRes, Headers } from './http_protocol';
import { HTTPError } from './errors';
import { handleReq, readerFromMemory } from './handler';
const logger = require('pino')();

async function serveClient(conn: TCPConn): Promise<void> {
  const buf: DynBuf = new DynBuf(Buffer.alloc(0), 0);
  while (true) {
    const msg: HTTPReq = buf.cutMessage();
    if (!msg) {
      // need more data
      const data: Buffer = await conn.read();
      buf.push(data);
      // EOF?
      if (data.length === 0 && buf.length === 0) {
        // omitted ...
        return;
      }
      if (data.length === 0) {
        throw new HTTPError(400, 'Unexpected EOF.');
      }
      // got some data, try it again.
      continue;
    }

    // logger.info(`get msg: %o`, msg);
    const reqBody: BodyReader = conn.readerFromReq(buf, msg);
    const res: HTTPRes = await handleReq(msg, reqBody);
    await conn.writeHTTPResp(res);
    // HTTP/1.0 协议的，收到一个消息后，就断开连接。
    // if (msg.version === '1.0') {
    //   return;
    // }
    // make sure that the request body is consumed completely
    while ((await reqBody.read()).length > 0) {
      /* empty */
    }
  }
}

async function newConn(socket: net.Socket): Promise<void> {
  logger.info(
    `new connection remoteAddress=${socket.remoteAddress} remotePort=${socket.remotePort}`
  );

  const conn: TCPConn = new TCPConn(socket);

  try {
    await serveClient(conn);
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

// type TCPListener = {
//     socket: net.Socket;
//     // ...
// };
//
// function soListen(): TCPListener;
// function soAccept(listener: TCPListener): Promise<TCPConn>;

// Create A Listening Socket
let server = net.createServer({
  // 默认情况下，一端发送/收到 EOF 后，会自动关闭链接
  // 如果打开下面的开关，socket.end() 不会再关闭连接，而只会发送 EOF。请使用 socket.destroy() 手动关闭套接字。
  allowHalfOpen: true, //
  // 表示是否应在接收连接时暂停套接字。
  pauseOnConnect: true, // required by `TCPConn`
  // 禁用  Nagle's 算法
  noDelay: true, // TCP_NODELAY
});
const PORT = 1234;
server.listen({ host: '127.0.0.1', port: PORT }, () => {
  logger.info(`server listening on port: ${PORT}`);
});

//
server.on('connection', newConn);

server.on('error', (err: Error) => {
  logger.error(err);
  throw err;
});
