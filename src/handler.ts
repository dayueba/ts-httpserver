import { BodyReader, HTTPReq, HTTPRes, Headers } from './http_protocol';
// import { logger } from './logger';
import * as fs from 'fs/promises';

export const handleReq = async (
  req: HTTPReq,
  body: BodyReader
): Promise<HTTPRes> => {
  let resp: BodyReader;
  const uri = req.uri.toString('latin1');
  if (uri.startsWith('/files/')) {
    // serve files from the current working directory
    // FIXME: prevent escaping by `..`
    return await serveStaticFile(uri.substr('/files/'.length));
  }
  switch (uri) {
    case '/echo':
      // http echo server
      resp = body;
      break;
    default:
      resp = readerFromMemory(Buffer.from('hello world.'));
      break;
  }
  return new HTTPRes(
    200,
    new Headers([Buffer.from('Server: my_first_http_server')]),
    resp
  );
};

// BodyReader from in-memory data
export const readerFromMemory = (data: Buffer): BodyReader => {
  let done = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer> => {
      if (done) {
        return Buffer.from(''); // no more data
      } else {
        done = true;
        return data;
      }
    },
  };
};

async function serveStaticFile(path: string): Promise<HTTPRes> {
  let fp: null | fs.FileHandle = null;
  try {
    // open the file
    fp = await fs.open(path, 'r');
    const stat = await fp.stat();
    if (!stat.isFile()) {
      return resp404(); // not a regular file?
    }
    const size = stat.size;
    const reader: BodyReader = readerFromStaticFile(fp, size);
    // fp = null; // the reader is now responsible for closing it instead
    // return { code: 200, headers: new Headers([]), body: reader };
    return new HTTPRes(
      200,
      new Headers([
        // Buffer.from('Server: my_first_http_server'),
        // Buffer.from(`Content-Length: ${size}`),
      ]),
      reader
    );
  } catch (exc) {
    // cannot open the file or whatever console.info('error serving file:', exc); return resp404();
  } finally {
    // make sure the file is closed
    fp = null; // transferred to the BodyReader
    await fp?.close();
  }
}

function resp404(): HTTPRes {
  return new HTTPRes(
    404,
    new Headers([Buffer.from('Server: my_first_http_server')]),
    readerFromMemory(Buffer.from('404 Not Found'))
  );
}

function readerFromStaticFile(fp: fs.FileHandle, size: number): BodyReader {
  const buf = Buffer.allocUnsafe(65536); // reused for each read
  let got = 0; // bytes read so far
  return {
    length: size,
    read: async (): Promise<Buffer> => {
      const r: fs.FileReadResult<Buffer> = await fp.read({ buffer: buf });
      got += r.bytesRead;
      if (got > size || (got < size && r.bytesRead === 0)) {
        // unhappy case: file size changed.
        // cannot continue since we have sent the `Content-Length`.
        throw new Error('file size changed, abandon it!');
      }
      // NOTE: the automatically allocated buffer may be larger
      return r.buffer.subarray(0, r.bytesRead);
    },
    close: async () => await fp.close(),
  };
}
