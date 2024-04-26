// Buffer长度是固定的，如果需要增加buffer则需要重新分配内存，再拼接
// 这样的坏处就是效率低下，我们可以模仿go的slice等动态数组实现动态buffer
import { HTTPError } from './errors';
import { HttpProtocol, HTTPReq, MaxHeaderLen } from './http_protocol';

export class DynBuf {
  data: Buffer;
  length: number;

  constructor(data: Buffer, length: number) {
    this.data = data;
    this.length = length;
  }

  push(data: Buffer): void {
    const newLen = this.length + data.length;
    if (this.data.length < newLen) {
      // grow the capacity by the power of two
      let cap = Math.max(this.data.length, 32);
      while (cap < newLen) {
        cap *= 2;
      }
      const grown = Buffer.alloc(cap);
      this.data.copy(grown, 0, 0);
      this.data = grown;
    }
    data.copy(this.data, this.length, 0);
    this.length = newLen;
  }

  // 复制一份报文数据，因为它将从缓冲区中删除。
  cutMessage(): HTTPReq {
    // messages are separated by '\n'
    const idx = this.data.subarray(0, this.length).indexOf('\r\n\r\n');
    if (idx < 0) {
      if (this.length >= MaxHeaderLen) {
        throw new HTTPError(413, 'header is too large');
      }
      return null; // not complete
    }
    // make a copy of the message and move the remaining data to the front
    const msg = HttpProtocol.parseHTTPReq(this.data.subarray(0, idx + 4));
    this.pop(idx + 4);
    return msg;
  }

  // 此时复杂度还是O(n*n)
  // todo 优化：当浪费空间 > 1/2时，再删除，这样复杂度就均摊了
  pop(len: number): void {
    this.data.copyWithin(0, len, this.length);
    this.length -= len;
  }
}
