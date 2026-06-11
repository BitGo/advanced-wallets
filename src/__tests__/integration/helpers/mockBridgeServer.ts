import * as http from 'http';
import express from 'express';
import { listen, close } from './servers';

export interface MockBridgeCall {
  method: string;
  path: string;
  body: unknown;
}

export interface MockBridgeServer {
  port: number;
  calls: MockBridgeCall[];
  close(): Promise<void>;
}

export async function startMockBridgeServer(): Promise<MockBridgeServer> {
  const calls: MockBridgeCall[] = [];

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    calls.push({ method: req.method, path: req.path, body: req.body });
    next();
  });

  app.post('*', (_req, res) => {
    res.status(202).json({ jobId: 'test-job-id' });
  });

  const server = http.createServer(app);
  const port = await listen(server);

  return { port, calls, close: () => close(server) };
}
