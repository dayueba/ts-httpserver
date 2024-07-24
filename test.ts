import * as net from 'net';

const server = net.createServer(conn => {
  conn.on('data', data => {
    console.log(data.toString());
  });
});

server.listen(8080);

export interface Reader {
  resolve: (value: Buffer) => void;
  reject: (reason: Error) => void;
}
export class Conn {
  reader: Reader;
  socket: net.Socket;

  constructor() {
    this.socket.on('data', (data: Buffer) => {
      this.reader.resolve(data);
    });
  }

  read(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.reader = { resolve: resolve, reject: reject };
      this.socket.resume();
    });
  }
}
