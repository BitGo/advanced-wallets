import 'should';
import { startServices, IntegServices } from './helpers/setup';
import { LOCALHOST } from './helpers/servers';
import { SigningMode } from '../../shared/types';

/**
 * Deterministic test keypair derived from Buffer.alloc(64, 0x42) — a public, reproducible seed.
 * Not a secret. Never funded. Matches getKeychain.user.json and consolidateAccount.hteth.json.
 */
const USER_XPUB =
  'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH';
const USER_XPRV =
  'xprv9s21ZrQH143K2SDwr5LpPcLbsf4FZJmnbzXKnqURCoqGwoR965apxWYoS2DKu2ivcMTB9uTK6XhZDEPfTeNXGf7mmACuMN6cFS5ttmrpZ3i';

const WALLET_ID = 'test-wallet-id';

const CONSOLIDATE_ADDRESSES = ['0xe01866e64418db20a2831e41eb11eca2a77245a3'];

const consolidateRequestBody = {
  pubkey: USER_XPUB,
  source: 'user' as const,
  consolidateAddresses: CONSOLIDATE_ADDRESSES,
};

interface ConsolidateSendResult {
  txid: string;
  tx: string;
  status: string;
  transfer: {
    txid: string;
    entries: Array<{ address: string; value: number }>;
  };
}

interface ConsolidateResponse {
  success: ConsolidateSendResult[];
  failure: unknown[];
}

describe('Consolidate account: EXTERNAL signing', () => {
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

  it('consolidates hteth account addresses via external key provider', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/hteth/advancedwallet/${WALLET_ID}/consolidate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(consolidateRequestBody),
      },
    );

    res.status.should.equal(200);
    const data = (await res.json()) as ConsolidateResponse;
    data.should.have.property('success');
    data.should.have.property('failure');
    data.success.should.be.Array().and.have.length(1);
    data.failure.should.be.Array().and.have.length(0);

    const result = data.success[0];
    result.should.have.property('txid', '0xtest-eth-tx-id');
    result.should.have.property('status', 'signed');
    result.should.have.property('transfer');
    result.transfer.should.have.property('txid', '0xtest-eth-tx-id');
    result.transfer.entries.should.be.Array().and.have.length(1);
    result.transfer.entries[0].should.have.property('address', CONSOLIDATE_ADDRESSES[0]);

    /**
     * In external mode, AWM sends the ETH operation hash (0x-prefixed) to the key provider.
     * POST /sign must be called; GET /key must not.
     */
    const signCalls = services.keyProvider.calls.filter((c) => c.path === '/sign');
    signCalls.should.have.length(1);
    const signBody = signCalls[0].body as { signablePayload: string };
    signBody.signablePayload.should.startWith('0x');

    services.keyProvider.calls.filter((c) => c.path === '/key').should.have.length(0);

    /**
     * BitGo must receive POST /consolidateAccount/build (not /tx/build or /consolidateUnspents),
     * then POST /tx/send for the signed build.
     */
    const consolidateBuildCalls = services.bitgo.calls.filter((c) =>
      c.path.endsWith('/consolidateAccount/build'),
    );
    consolidateBuildCalls.should.have.length(1);
    const buildBody = consolidateBuildCalls[0].body as { consolidateAddresses?: string[] };
    buildBody.should.have.property('consolidateAddresses');
    buildBody.consolidateAddresses!.should.deepEqual(CONSOLIDATE_ADDRESSES);

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(1);
    const sendBody = sendCalls[0].body as { halfSigned?: { signature?: string } };
    sendBody.should.have.property('halfSigned');
    (sendBody.halfSigned as { signature: string }).should.have.property('signature');

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(0);
    services.bitgo.calls
      .filter((c) => c.path.endsWith('/consolidateUnspents'))
      .should.have.length(0);
  });
});

describe('Consolidate account: LOCAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.LOCAL });

    /**
     * Seed the mock key provider with a known xprv so AWM can retrieve it
     * via GET /key/:pub and sign the ETH operation hash locally.
     * The xpub must match getKeychain.user.json.
     */
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

  it('consolidates hteth account addresses using locally stored xprv', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/hteth/advancedwallet/${WALLET_ID}/consolidate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(consolidateRequestBody),
      },
    );

    res.status.should.equal(200);
    const data = (await res.json()) as ConsolidateResponse;
    data.should.have.property('success');
    data.should.have.property('failure');
    data.success.should.be.Array().and.have.length(1);
    data.failure.should.be.Array().and.have.length(0);

    const result = data.success[0];
    result.should.have.property('txid', '0xtest-eth-tx-id');
    result.should.have.property('status', 'signed');
    result.should.have.property('transfer');
    result.transfer.should.have.property('txid', '0xtest-eth-tx-id');
    result.transfer.entries.should.be.Array().and.have.length(1);
    result.transfer.entries[0].should.have.property('address', CONSOLIDATE_ADDRESSES[0]);

    /**
     * In local mode, AWM retrieves the xprv via GET /key/:pub and signs the ETH operation hash
     * internally. POST /sign must NOT be called — signing happens inside AWM, not in the key provider.
     */
    services.keyProvider.calls.filter((c) => c.path === '/sign').should.have.length(0);
    services.keyProvider.calls.filter((c) => c.path.startsWith('/key/')).length.should.be.above(0);

    /**
     * BitGo must receive POST /consolidateAccount/build with the consolidateAddresses param,
     * followed by POST /tx/send. Neither /tx/build nor /consolidateUnspents should be called.
     */
    const consolidateBuildCalls = services.bitgo.calls.filter((c) =>
      c.path.endsWith('/consolidateAccount/build'),
    );
    consolidateBuildCalls.should.have.length(1);
    const buildBody = consolidateBuildCalls[0].body as { consolidateAddresses?: string[] };
    buildBody.should.have.property('consolidateAddresses');
    buildBody.consolidateAddresses!.should.deepEqual(CONSOLIDATE_ADDRESSES);

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(1);
    const sendBody = sendCalls[0].body as { halfSigned?: { signature?: string } };
    sendBody.should.have.property('halfSigned');
    (sendBody.halfSigned as { signature: string }).should.have.property('signature');

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(0);
    services.bitgo.calls
      .filter((c) => c.path.endsWith('/consolidateUnspents'))
      .should.have.length(0);
  });
});
