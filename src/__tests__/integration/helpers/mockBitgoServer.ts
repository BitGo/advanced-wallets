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

function loadFixture(name: string): Record<string, unknown> {
  return require(`${FIXTURES_DIR}/${name}.json`);
}

type SendManyFixtureMethod = 'getWallet' | 'prebuildTx' | 'sendTx';
type SupportedCoin = 'hteth' | 'tbtc';
type CoinToFixtures<C extends SupportedCoin> = {
  [K in SendManyFixtureMethod]: `${K}.${C}`;
};

/** Registry — add a new coin here to support it across all sendMany integ test routes */
const COIN_FIXTURES: { [C in SupportedCoin]: CoinToFixtures<C> } = {
  hteth: { getWallet: 'getWallet.hteth', prebuildTx: 'prebuildTx.hteth', sendTx: 'sendTx.hteth' },
  tbtc: { getWallet: 'getWallet.tbtc', prebuildTx: 'prebuildTx.tbtc', sendTx: 'sendTx.tbtc' },
};

function coinFixtures(coin: string): CoinToFixtures<SupportedCoin> {
  const fixtures = COIN_FIXTURES[coin as SupportedCoin];
  if (!fixtures) throw new Error(`No fixtures registered for coin: ${coin}`);
  return fixtures;
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
    const fixture = loadFixture(fixtureName);
    return res.json({ ...fixture, coin });
  });

  /** Create wallet */
  app.post('/api/v2/:coin/wallet/add', (req, res) => {
    const { coin } = req.params;
    const fixture = loadFixture('createWallet');
    res.json({ ...fixture, coin });
  });

  /** Get wallet — coin-specific fixture */
  app.get('/api/v2/:coin/wallet/:walletId', (req, res) => {
    const { coin } = req.params;
    const fixture = loadFixture(coinFixtures(coin).getWallet);
    res.json({ ...fixture, coin });
  });

  /** Get keychain — matched by keyId */
  app.get('/api/v2/:coin/key/:keyId', (req, res) => {
    const { keyId, coin } = req.params;
    const fixtureName =
      keyId === 'user-key-id'
        ? 'getKeychain.user'
        : keyId === 'backup-key-id'
        ? 'getKeychain.backup'
        : 'getKeychain.bitgo';
    const fixture = loadFixture(fixtureName);
    res.json({ ...fixture, coin });
  });

  /** Block height for fee estimation */
  app.get('/api/v2/:coin/public/block/latest', (_req, res) => {
    res.json(loadFixture('blockLatest'));
  });

  /** Transaction prebuild — coin-specific fixture */
  app.post('/api/v2/:coin/wallet/:walletId/tx/build', (req, res) => {
    res.json(loadFixture(coinFixtures(req.params.coin).prebuildTx));
  });

  /** Transaction submit — coin-specific fixture */
  app.post('/api/v2/:coin/wallet/:walletId/tx/send', (req, res) => {
    res.json(loadFixture(coinFixtures(req.params.coin).sendTx));
  });

  const server = http.createServer(app);
  const port = await listen(server);

  return { port, calls, close: () => close(server) };
}
