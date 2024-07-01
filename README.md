# 使用ts 和 原生 net 库实现 http

## 知识点

### half-open connection
在HTTP框架或更底层的TCP通信中，"半关闭"（Half-Close）是指TCP连接中一种特殊的状态，其中一个方向的数据传输已经完成并被终止，但另一个方向的数据传输仍然保持开放。TCP是全双工的，意味着数据可以同时在两个方向上传输。半关闭的概念允许通信双方在完成自己发送数据的任务后通知对方，而不必立即终止整个连接。

具体到HTTP框架的上下文中，半关闭通常不是直接由HTTP协议本身直接定义的操作，而是依赖于底层TCP连接的特性。例如，在某些场景下，客户端可能完成了所有数据的请求发送，但它仍想接收服务器的响应数据。这时，客户端可以发起一个TCP半关闭操作，通过发送一个FIN（Finish）标志位的包给服务器，表示它不会再发送更多的数据。服务器收到FIN包后，会进入FIN_WAIT_2状态，知道客户端不再发送数据，但它仍可以继续向客户端发送响应数据，直到它也完成数据发送并发送FIN包给客户端，从而完成整个连接的关闭。

在实际的HTTP通信中，这种半关闭的操作并不常见，因为HTTP规范通常建议完整地关闭连接（即四次挥手过程完成），特别是在短连接模式下。但在长连接（如HTTP/1.1的Keep-Alive连接）或某些特定的应用场景下，半关闭机制可以提供更灵活的资源管理和数据传输控制手段。在某些框架中，可能会提供API（如Python的socket.shutdown()方法或Node.js的socket.end()方法）允许开发者手动触发TCP的半关闭行为。
```javascript
let server = net.createServer({allowHalfOpen: true});
socket.end() // 不断开链接，只发送EOF
socket.destroy() // 彻底断开链接
```

原生 http 库中也是默认打开的
```javascript
net.Server.call(this, { allowHalfOpen: true })
```

###  Backpressure

### Pipelined Requests


## ts
```typescript
export class Conn {
    reader: Reader | null; // 写法1

    reader2: Reader; // 写法2
}
```


```typescript
type TcpConn = {
    reader: Reader;
}

function foo(conn: TcpConn) {
}

class TcpConn {
    reader: Reader;
    
    foo() {
        
    }
}
```

```typescript
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
```

```typescript
// 区别
this.server.on('connection', conn => this.newConn(conn));
this.server.on('connection', this.newConn);
```
