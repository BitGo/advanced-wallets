import * as http from 'http';
import * as net from 'net';

export const LOCALHOST = '127.0.0.1';

export function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOCALHOST, () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

export function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
