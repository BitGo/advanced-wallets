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
const ETH_RECIPIENT = '0xe01866e64418db20a2831e41eb11eca2a77245a3';

describe('Send many: EXTERNAL signing', () => {
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

  it('signs and submits a tbtc sendMany transaction via external key provider', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/${WALLET_ID}/sendMany`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({
          recipients: [
            {
              address: 'tb1qdgj9n5nw33k2qk26mxu7j5hv30dapz6fewscd4jd87euyjxyp04qgphg92',
              amount: '10000',
            },
          ],
          source: 'user',
          pubkey:
            'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH',
        }),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as { txid: string; status: string };
    body.should.have.property('txid', 'test-tx-id');
    body.should.have.property('status', 'signed');

    /**
     * In external mode, AWM delegates signing to the key provider.
     * POST /sign must be called — not POST /key (no local key generation for signing).
     */
    const signCalls = services.keyProvider.calls.filter((c) => c.path === '/sign');
    signCalls.should.have.length(1);

    const storeCalls = services.keyProvider.calls.filter((c) => c.path === '/key');
    storeCalls.should.have.length(0);

    /** BitGo must receive tx/build and tx/send */
    const buildCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build'));
    buildCalls.should.have.length(1);

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(1);
  });
});

describe('Send many: EXTERNAL signing (hteth — operation hash flow)', () => {
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

  it('signs and submits an hteth sendMany via operation hash', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/hteth/advancedwallet/${WALLET_ID}/sendMany`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({
          recipients: [{ address: ETH_RECIPIENT, amount: '100000000000000' }],
          source: 'user',
          pubkey:
            'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH',
        }),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as { txid: string; status: string };
    body.should.have.property('txid', '0xtest-eth-tx-id');
    body.should.have.property('status', 'signed');

    /**
     * For ETH external signing, AWM computes operationHash = sha3(recipients + expireTime + sequenceId)
     * and sends that hash (starting with 0x) to the key provider — NOT the full PSBT.
     * This is the critical difference from the BTC flow.
     */
    const signCalls = services.keyProvider.calls.filter((c) => c.path === '/sign');
    signCalls.should.have.length(1);
    const signPayload = (signCalls[0].body as { signablePayload: string }).signablePayload;
    signPayload.should.startWith('0x');

    /** POST /key must NOT be called */
    services.keyProvider.calls.filter((c) => c.path === '/key').should.have.length(0);

    /** BitGo must receive tx/build and tx/send */
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(1);
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send')).should.have.length(1);
  });
});

describe('Send many: LOCAL signing (tbtc)', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.LOCAL });

    /**
     * Seed the mock key provider with a known xprv so AWM can retrieve it
     * via GET /key/:pub and sign the PSBT locally. The xpub must match
     * getKeychain.user.json and the bip32Derivation in prebuildTx.tbtc.json.
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

  it('signs a tbtc sendMany locally using the stored xprv', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/${WALLET_ID}/sendMany`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({
          recipients: [
            {
              address: 'tb1qdgj9n5nw33k2qk26mxu7j5hv30dapz6fewscd4jd87euyjxyp04qgphg92',
              amount: '10000',
            },
          ],
          source: 'user',
          pubkey: USER_XPUB,
        }),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as { txid: string; status: string };
    body.should.have.property('txid', 'test-tx-id');
    body.should.have.property('status', 'signed');

    /**
     * In local mode, AWM retrieves the xprv via GET /key/:pub and signs internally.
     * POST /sign must NOT be called — signing happens inside AWM, not in the key provider.
     */
    services.keyProvider.calls.filter((c) => c.path === '/sign').should.have.length(0);
    services.keyProvider.calls.filter((c) => c.path.startsWith('/key/')).length.should.be.above(0);

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(1);
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send')).should.have.length(1);
  });
});

describe('Send many: LOCAL signing (hteth)', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.LOCAL });

    /** Seed mock key provider with known xprv so AWM can sign locally */
    await fetch(`http://127.0.0.1:${services.keyProvider.port}/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pub: USER_XPUB,
        prv: USER_XPRV,
        coin: 'hteth',
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

  it('signs an hteth sendMany locally using the stored xprv', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/hteth/advancedwallet/${WALLET_ID}/sendMany`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({
          recipients: [{ address: ETH_RECIPIENT, amount: '100000000000000' }],
          source: 'user',
          pubkey: USER_XPUB,
        }),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as { txid: string; status: string };
    body.should.have.property('txid', '0xtest-eth-tx-id');
    body.should.have.property('status', 'signed');

    /**
     * In local mode, AWM retrieves xprv via GET /key/:pub and signs the
     * operation hash internally — POST /sign is never called.
     */
    services.keyProvider.calls.filter((c) => c.path === '/sign').should.have.length(0);
    services.keyProvider.calls.filter((c) => c.path.startsWith('/key/')).length.should.be.above(0);

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(1);
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send')).should.have.length(1);
  });
});
