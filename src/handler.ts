import { BodyReader, HTTPReq, HTTPRes, Headers } from './http_protocol';
// import { logger } from './logger';

export const handleReq = async (
  req: HTTPReq,
  body: BodyReader
): Promise<HTTPRes> => {
  let resp: BodyReader;
  switch (req.uri.toString('latin1')) {
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
