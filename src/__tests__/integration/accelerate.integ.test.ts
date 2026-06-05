import 'should';
import { startServices, IntegServices } from './helpers/setup';
import { LOCALHOST } from './helpers/servers';
import { SigningMode } from '../../shared/types';

/**
 * Deterministic test keypair derived from Buffer.alloc(64, 0x42) — a public, reproducible seed.
 * Not a secret. Never funded. Matches getKeychain.user.json and prebuildTx.tbtc.json.
 */
const USER_XPUB =
  'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH';
const USER_XPRV =
  'xprv9s21ZrQH143K2SDwr5LpPcLbsf4FZJmnbzXKnqURCoqGwoR965apxWYoS2DKu2ivcMTB9uTK6XhZDEPfTeNXGf7mmACuMN6cFS5ttmrpZ3i';

const WALLET_ID = 'test-wallet-id';
const CPFP_TX_ID = 'b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26';

const accelerateRequestBody = {
  pubkey: USER_XPUB,
  source: 'user' as const,
  cpfpTxIds: [CPFP_TX_ID],
  cpfpFeeRate: 50,
  maxFee: 10000,
};

describe('Accelerate: EXTERNAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.EXTERNAL });
  });

  after(async () => {
    await services.teardown();
  });

  beforeEach(() => {
    services.keyProvider.calls.length = 0;
    services.bitgo.calls.length = 0;
  });

  it('accelerates a tbtc transaction via CPFP using external key provider', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/${WALLET_ID}/accelerate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(accelerateRequestBody),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as { txid: string; tx: string; status: string };
    body.should.have.property('txid', 'test-tx-id');
    body.should.have.property('tx', '01000000000101030a0000');
    body.should.have.property('status', 'signed');

    /**
     * In external mode, AWM delegates signing to the key provider.
     * POST /sign must be called — not POST /key (no local key retrieval for signing).
     */
    services.keyProvider.calls.filter((c) => c.path === '/sign').should.have.length(1);
    services.keyProvider.calls.filter((c) => c.path === '/key').should.have.length(0);

    /** BitGo must receive tx/build, block/latest, and tx/send */
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(1);
    services.bitgo.calls
      .filter((c) => c.path.endsWith('/public/block/latest'))
      .should.have.length(1);
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send')).should.have.length(1);
  });
});

describe('Accelerate: LOCAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.LOCAL });

    /**
     * Seed the mock key provider with a known xprv so AWM can retrieve it
     * via GET /key/:pub and sign the PSBT locally. The xpub must match
     * getKeychain.user.json and prebuildTx.accelerate.tbtc.json.
     */
    await fetch(`http://127.0.0.1:${services.keyProvider.port}/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pub: USER_XPUB,
        prv: USER_XPRV,
        coin: 'tbtc',
        source: 'user',
        type: 'independent',
      }),
    });
  });

  after(async () => {
    await services.teardown();
  });

  beforeEach(() => {
    services.keyProvider.calls.length = 0;
    services.bitgo.calls.length = 0;
  });

  it('accelerates a tbtc transaction via CPFP using locally stored xprv', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/${WALLET_ID}/accelerate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(accelerateRequestBody),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as { txid: string; tx: string; status: string };
    body.should.have.property('txid', 'test-tx-id');
    body.should.have.property('tx', '01000000000101030a0000');
    body.should.have.property('status', 'signed');

    /**
     * In local mode, AWM retrieves the xprv via GET /key/:pub and signs internally.
     * POST /sign must NOT be called — signing happens inside AWM, not in the key provider.
     */
    services.keyProvider.calls.filter((c) => c.path === '/sign').should.have.length(0);
    services.keyProvider.calls.filter((c) => c.path.startsWith('/key/')).length.should.be.above(0);

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(1);
    services.bitgo.calls
      .filter((c) => c.path.endsWith('/public/block/latest'))
      .should.have.length(1);
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send')).should.have.length(1);
  });
});
