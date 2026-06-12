import * as http from 'http';
import express from 'express';
import { listen, close } from './servers';
import { BridgeJobResponse } from '../../../masterBitgoExpress/clients/bridgeClient.types';

export interface MockBridgeCall {
  method: string;
  path: string;
  body: unknown;
}

export interface MockBridgeServer {
  port: number;
  calls: MockBridgeCall[];
  /** Load jobs that GET /jobs?status=awaiting_bitgo will return on the next poll (one-shot). */
  setPendingJobs(jobs: BridgeJobResponse[]): void;
  close(): Promise<void>;
}

export async function startMockBridgeServer(): Promise<MockBridgeServer> {
  const calls: MockBridgeCall[] = [];
  let pendingJobs: BridgeJobResponse[] = [];

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    calls.push({ method: req.method, path: req.path, body: req.body });
    next();
  });

  /** Worker polls this — returns pending jobs once, then empty so the worker doesn't loop forever */
  app.get('/jobs', (_req, res) => {
    const jobs = pendingJobs;
    pendingJobs = [];
    res.json({ jobs });
  });

  app.patch('/job/:jobId', (_req, res) => {
    res.status(204).send();
  });

  /** Async submit from MBE request handlers */
  app.post('*', (_req, res) => {
    res.status(202).json({ jobId: 'test-job-id' });
  });

  const server = http.createServer(app);
  const port = await listen(server);

  return {
    port,
    calls,
    setPendingJobs(jobs: BridgeJobResponse[]) {
      pendingJobs = jobs;
    },
    close: () => close(server),
  };
}
