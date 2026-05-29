import * as http from 'http';
import * as path from 'path';
import express from 'express';
import { listen, close } from './servers';

export interface MockBitgoCall {
  method: string;
  path: string;
  body: unknown;
}

export interface MockBitgoServer {
  port: number;
  calls: MockBitgoCall[];
  close(): Promise<void>;
}

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/bitgo');

function loadFixture(name: string): unknown {
  return require(`${FIXTURES_DIR}/${name}.json`);
}

export async function startMockBitgoServer(): Promise<MockBitgoServer> {
  const calls: MockBitgoCall[] = [];

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    calls.push({ method: req.method, path: req.path, body: req.body });
    next();
  });

  /** SDK calls this on every BitGo instance initialisation */
  app.get('/api/v1/client/constants', (_req, res) => {
    res.json({ ttl: 3600, constants: {} });
  });

  /** Add keychain — source distinguishes user / backup / bitgo */
  app.post('/api/v2/:coin/key', (req, res) => {
    const { coin } = req.params;
    const source = req.body?.source;
    const fixtureName =
      source === 'user' ? 'addKey.user' : source === 'backup' ? 'addKey.backup' : 'addKey.bitgo';
    const fixture = loadFixture(fixtureName) as Record<string, unknown>;
    return res.json({ ...fixture, coin });
  });

  /** Create wallet */
  app.post('/api/v2/:coin/wallet/add', (req, res) => {
    const { coin } = req.params;
    const fixture = loadFixture('createWallet') as Record<string, unknown>;
    res.json({ ...fixture, coin });
  });

  const server = http.createServer(app);
  const port = await listen(server);

  return { port, calls, close: () => close(server) };
}
