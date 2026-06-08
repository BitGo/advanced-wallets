import 'should';
import { startServices, IntegServices } from './helpers/setup';
import { LOCALHOST } from './helpers/servers';
import { SigningMode } from '../../shared/types';

/**
 * Deterministic test keypair derived from Buffer.alloc(64, 0x42) — a public, reproducible seed.
 * Not a secret. Never funded. Matches getKeychain.user.json and prebuildTx.consolidate.tbtc.json.
 */
const USER_XPUB =
  'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH';
const USER_XPRV =
  'xprv9s21ZrQH143K2SDwr5LpPcLbsf4FZJmnbzXKnqURCoqGwoR965apxWYoS2DKu2ivcMTB9uTK6XhZDEPfTeNXGf7mmACuMN6cFS5ttmrpZ3i';

const WALLET_ID = 'test-wallet-id';

const consolidateRequestBody = {
  pubkey: USER_XPUB,
  source: 'user' as const,
  feeRate: 1000,
  maxFeeRate: 2000,
  minValue: 1000,
};

interface TransferEntry {
  address: string;
  value: number;
  isChange?: boolean;
}

interface ConsolidateResponse {
  txid: string;
  tx: string;
  status: string;
  transfer: {
    txid: string;
    status: string;
    entries: TransferEntry[];
  };
}

describe('Consolidate unspents: EXTERNAL signing', () => {
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

  it('consolidates tbtc unspents via external key provider', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/${WALLET_ID}/consolidateunspents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(consolidateRequestBody),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as ConsolidateResponse;
    body.should.have.property('txid', 'test-tx-id');
    body.should.have.property('tx', '01000000000101030a0000');
    body.should.have.property('status', 'signed');
    body.transfer.should.have.property('txid', 'test-tx-id');
    body.transfer.entries.should.be.Array().and.have.length(2);

    /**
     * In external mode, AWM delegates signing to the key provider.
     * POST /sign must be called — not POST /key (no local key retrieval for signing).
     * The signablePayload for BTC is a PSBT hex (starts with PSBT magic bytes 70736274ff).
     */
    const signCalls = services.keyProvider.calls.filter((c) => c.path === '/sign');
    signCalls.should.have.length(1);
    const signBody = signCalls[0].body as { signablePayload: string };
    signBody.signablePayload.should.startWith('70736274ff');

    services.keyProvider.calls.filter((c) => c.path === '/key').should.have.length(0);

    /**
     * BitGo must receive consolidateUnspents (not tx/build) with the consolidation params,
     * then tx/send with type: 'consolidate'. tx/build is only used by sendMany and accelerate.
     */
    const consolidateCalls = services.bitgo.calls.filter((c) =>
      c.path.endsWith('/consolidateUnspents'),
    );
    consolidateCalls.should.have.length(1);
    const consolidateBody = consolidateCalls[0].body as {
      feeRate?: number;
      maxFeeRate?: number;
      minValue?: number;
      txFormat?: string;
    };
    consolidateBody.should.have.property('feeRate', 1000);
    consolidateBody.should.have.property('maxFeeRate', 2000);
    consolidateBody.should.have.property('minValue', 1000);
    consolidateBody.should.have.property('txFormat', 'psbt-lite');

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(1);
    const sendBody = sendCalls[0].body as { type?: string };
    sendBody.should.have.property('type', 'consolidate');

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(0);
  });
});

describe('Consolidate unspents: LOCAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.LOCAL });

    /**
     * Seed the mock key provider with a known xprv so AWM can retrieve it
     * via GET /key/:pub and sign the PSBT locally. The xpub must match
     * getKeychain.user.json and the bip32Derivation in prebuildTx.consolidate.tbtc.json.
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

  it('consolidates tbtc unspents using locally stored xprv', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/${WALLET_ID}/consolidateunspents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(consolidateRequestBody),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as ConsolidateResponse;
    body.should.have.property('txid', 'test-tx-id');
    body.should.have.property('tx', '01000000000101030a0000');
    body.should.have.property('status', 'signed');
    body.transfer.should.have.property('txid', 'test-tx-id');
    body.transfer.entries.should.be.Array().and.have.length(2);

    /**
     * In local mode, AWM retrieves the xprv via GET /key/:pub and signs internally.
     * POST /sign must NOT be called — signing happens inside AWM, not in the key provider.
     */
    services.keyProvider.calls.filter((c) => c.path === '/sign').should.have.length(0);
    services.keyProvider.calls.filter((c) => c.path.startsWith('/key/')).length.should.be.above(0);

    /**
     * BitGo must receive consolidateUnspents (not tx/build) with the consolidation params,
     * then tx/send with type: 'consolidate'.
     */
    const consolidateCalls = services.bitgo.calls.filter((c) =>
      c.path.endsWith('/consolidateUnspents'),
    );
    consolidateCalls.should.have.length(1);
    const consolidateBody = consolidateCalls[0].body as {
      feeRate?: number;
      maxFeeRate?: number;
      minValue?: number;
      txFormat?: string;
    };
    consolidateBody.should.have.property('feeRate', 1000);
    consolidateBody.should.have.property('maxFeeRate', 2000);
    consolidateBody.should.have.property('minValue', 1000);
    consolidateBody.should.have.property('txFormat', 'psbt-lite');

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(1);
    const sendBody = sendCalls[0].body as { type?: string };
    sendBody.should.have.property('type', 'consolidate');

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(0);
  });
});
