import * as http from 'http';
import express from 'express';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { Hteth } from '@bitgo-beta/sdk-coin-eth';
import { Tbtc } from '@bitgo-beta/sdk-coin-btc';
import { listen, close } from './servers';

export interface MockKeyProviderCall {
  method: string;
  path: string;
  body: unknown;
}

export interface MockKeyProviderServer {
  port: number;
  calls: MockKeyProviderCall[];
  close(): Promise<void>;
}

interface StoredKey {
  prv: string;
  source: string;
  type: string;
}

/**
 * @returns BitGo Instance with coins registered
 */
function createBitgoInstance(): BitGoAPI {
  const instance = new BitGoAPI({ env: 'test' });
  instance.register('hteth', Hteth.createInstance);
  instance.register('tbtc', Tbtc.createInstance);
  return instance;
}

function generateKeypair(coin: string): { pub: string; prv: string } {
  const keychain = createBitgoInstance().coin(coin).keychains().create();
  if (!keychain.pub || !keychain.prv)
    throw new Error(`Failed to generate keypair for coin: ${coin}`);
  return { pub: keychain.pub, prv: keychain.prv };
}

export async function startMockKeyProviderServer(): Promise<MockKeyProviderServer> {
  const calls: MockKeyProviderCall[] = [];
  const keyStore = new Map<string, StoredKey>();

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    calls.push({ method: req.method, path: req.path, body: req.body });
    next();
  });

  /** External signing mode — key provider generates the key */
  app.post('/key/generate', (req, res) => {
    const { coin, source, type } = req.body;
    const { pub, prv } = generateKeypair(coin);
    keyStore.set(pub, { prv, source, type });
    res.json({ pub, coin, source, type });
  });

  /** Local signing mode — AWM generates the key and sends it here for storage */
  app.post('/key', (req, res) => {
    const { pub, prv, coin, source, type } = req.body;
    keyStore.set(pub, { prv, source, type });
    res.json({ pub, coin, source, type });
  });

  const server = http.createServer(app);
  const port = await listen(server);

  return { port, calls, close: () => close(server) };
}
