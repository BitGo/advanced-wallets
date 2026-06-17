import 'should';
import assert from 'assert';
import { startServices, IntegServices } from './helpers/setup';
import { BridgeJobResponse } from '../../masterBitgoExpress/clients/bridgeClient.types';
import { MockBridgeServer } from './helpers/mockBridgeServer';

const COIN = 'tbtc';
const WALLET_ID = 'test-wallet-id';
const JOB_ID = 'integ-job-123';
const CPFP_TX_ID = 'b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26';

const USER_XPUB =
  'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH';

async function waitForJobCompletion(
  bridge: MockBridgeServer,
  jobId: string,
  maxWaitMs: number,
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 50;

  while (Date.now() - startTime < maxWaitMs) {
    const patchCall = bridge.calls.find((c) => c.method === 'PATCH' && c.path === `/job/${jobId}`);
    if (patchCall) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Job ${jobId} did not complete within ${maxWaitMs}ms. Recorded calls: ${JSON.stringify(
      bridge.calls,
      null,
      2,
    )}`,
  );
}

function makeAwaitingBitgoJob(overrides: Partial<BridgeJobResponse> = {}): BridgeJobResponse {
  return {
    jobId: JOB_ID,
    status: 'awaiting_bitgo',
    version: 1,
    coin: COIN,
    operationType: 'multisig_keygen',
    awmResponse: {
      status: 200,
      body: {
        id: 'user-key-id',
        pub: 'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH',
        type: 'independent',
        source: 'user',
        coin: COIN,
      },
    },
    awmBackupResponse: {
      status: 200,
      body: {
        id: 'backup-key-id',
        pub: 'xpub661MyMwAqRbcFnihegj1Mo2ePZoMQyLbBYpW7gDXZ7qzqxF3FBAkNAP8Gki8Mxx2BVLjN3RRa75pt5apD2g3ewXPrCfdssAJ7VupXqucLsb',
        type: 'independent',
        source: 'backup',
        coin: COIN,
      },
    },
    request: {
      endpoint: `/api/${COIN}/key/independent`,
      method: 'POST',
      body: { label: 'integ-test-wallet', enterprise: 'test-enterprise' },
    },
    createdAt: 1717977600,
    updatedAt: 1717977600,
    ttl: 3600,
    ...overrides,
  };
}

function makeAwaitingBitgoSignJob(overrides: Partial<BridgeJobResponse> = {}): BridgeJobResponse {
  return {
    jobId: JOB_ID,
    status: 'awaiting_bitgo',
    version: 1,
    coin: COIN,
    operationType: 'multisig_sign',
    awmResponse: {
      status: 200,
      body: { txHex: 'signed-tx-hex' },
    },
    request: {
      endpoint: `/api/${COIN}/multisig/sign`,
      method: 'POST',
      body: {
        source: 'user',
        pub: USER_XPUB,
        txPrebuild: {
          txHex: '70736274ff',
          txInfo: { nP2SHInputs: 0, nSegwitInputs: 1, nOutputs: 1 },
        },
        walletId: WALLET_ID,
        wpSubmitKind: 'sendMany',
        wpSubmitParams: {
          recipients: [
            {
              address: 'tb1qdgj9n5nw33k2qk26mxu7j5hv30dapz6fewscd4jd87euyjxyp04qgphg92',
              amount: '10000',
            },
          ],
          source: 'user',
          txFormat: 'psbt-lite',
        },
      },
    },
    createdAt: 1717977600,
    updatedAt: 1717977600,
    ttl: 3600,
    ...overrides,
  };
}

function makeAwaitingBitgoAccelerateJob(
  overrides: Partial<BridgeJobResponse> = {},
): BridgeJobResponse {
  return {
    jobId: JOB_ID,
    status: 'awaiting_bitgo',
    version: 1,
    coin: COIN,
    operationType: 'multisig_sign',
    awmResponse: {
      status: 200,
      body: { txHex: 'signed-tx-hex' },
    },
    request: {
      endpoint: `/api/${COIN}/multisig/sign`,
      method: 'POST',
      body: {
        source: 'user',
        pub: USER_XPUB,
        txPrebuild: {
          txHex: '70736274ff',
          txInfo: { nP2SHInputs: 0, nSegwitInputs: 1, nOutputs: 1 },
        },
        walletId: WALLET_ID,
        wpSubmitKind: 'accelerate',
        wpSubmitParams: {
          pubkey: USER_XPUB,
          source: 'user',
          cpfpTxIds: [CPFP_TX_ID],
          cpfpFeeRate: 50,
          maxFee: 10000,
          recipients: [],
          txFormat: 'psbt-lite',
        },
      },
    },
    createdAt: 1717977600,
    updatedAt: 1717977600,
    ttl: 3600,
    ...overrides,
  };
}

describe('asyncJobWorker: end-to-end polling', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ asyncMode: true });
  });

  after(async () => {
    await services.teardown();
  });

  beforeEach(() => {
    services.bitgo.calls.length = 0;
    assert(services.bridge, 'bridge service should be defined');
    services.bridge.calls.length = 0;
  });

  it('picks up an awaiting_bitgo keygen job, creates wallet, and PATCHes complete', async () => {
    const jobId = JOB_ID;
    assert(services.bridge, 'bridge service should be defined');
    services.bridge.setPendingJobs([makeAwaitingBitgoJob()]);

    await waitForJobCompletion(services.bridge, jobId, 5000);

    const keyCalls = services.bitgo.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/key'),
    );
    keyCalls.should.have.length(3);

    const walletAddCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/wallet/add'));
    walletAddCalls.should.have.length(1);

    const patchCall = services.bridge.calls.find(
      (c) => c.method === 'PATCH' && c.path === `/job/${jobId}`,
    );
    assert(patchCall !== undefined, `expected PATCH /job/${jobId} to be called`);
    const patchBody = patchCall.body as { status: string; result: { walletId: string } };
    patchBody.status.should.equal('complete');
    patchBody.result.should.have.property('walletId', 'test-wallet-id');
  });

  it('PATCHes job failed when awmResponse.body is not a valid keychain', async () => {
    const jobId = JOB_ID;
    assert(services.bridge, 'bridge service should be defined');
    services.bridge.setPendingJobs([
      makeAwaitingBitgoJob({
        awmResponse: { status: 200, body: { bad: 'shape' } },
      }),
    ]);

    await waitForJobCompletion(services.bridge, jobId, 5000);

    const patchCall = services.bridge.calls.find(
      (c) => c.method === 'PATCH' && c.path === `/job/${jobId}`,
    );
    assert(patchCall !== undefined, `expected PATCH /job/${jobId} to be called`);
    (patchCall.body as { status: string }).status.should.equal('failed');
  });

  it('picks up an awaiting_bitgo multisig_sign job, submits to WP, and PATCHes complete', async () => {
    assert(services.bridge, 'bridge service should be defined');
    services.bridge.setPendingJobs([makeAwaitingBitgoSignJob()]);

    await waitForJobCompletion(services.bridge, JOB_ID, 5000);

    const walletGetCalls = services.bitgo.calls.filter(
      (c) => c.method === 'GET' && c.path.endsWith(`/wallet/${WALLET_ID}`),
    );
    walletGetCalls.should.have.length(1);

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(1);

    const patchCall = services.bridge.calls.find(
      (c) => c.method === 'PATCH' && c.path === `/job/${JOB_ID}`,
    );
    assert(patchCall !== undefined, `expected PATCH /job/${JOB_ID} to be called`);
    const patchBody = patchCall.body as { status: string; result: { txid: string } };
    patchBody.status.should.equal('complete');
    patchBody.result.should.have.property('txid', 'test-tx-id');
  });

  it('PATCHes multisig_sign job failed when awmResponse.body is not a valid signed transaction', async () => {
    assert(services.bridge, 'bridge service should be defined');
    services.bridge.setPendingJobs([
      makeAwaitingBitgoSignJob({
        awmResponse: { status: 200, body: { bad: 'shape' } },
      }),
    ]);

    await waitForJobCompletion(services.bridge, JOB_ID, 5000);

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(0);

    const patchCall = services.bridge.calls.find(
      (c) => c.method === 'PATCH' && c.path === `/job/${JOB_ID}`,
    );
    assert(patchCall !== undefined, `expected PATCH /job/${JOB_ID} to be called`);
    (patchCall.body as { status: string }).status.should.equal('failed');
  });

  it('picks up an awaiting_bitgo accelerate job, submits cpfp params to WP, and PATCHes complete', async () => {
    assert(services.bridge, 'bridge service should be defined');
    services.bridge.setPendingJobs([makeAwaitingBitgoAccelerateJob()]);

    await waitForJobCompletion(services.bridge, JOB_ID, 5000);

    const walletGetCalls = services.bitgo.calls.filter(
      (c) => c.method === 'GET' && c.path.endsWith(`/wallet/${WALLET_ID}`),
    );
    walletGetCalls.should.have.length(1);

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(1);
    const sendBody = sendCalls[0].body as { cpfpTxIds?: string[]; txHex?: string };
    sendBody.should.have.property('cpfpTxIds').which.deepEqual([CPFP_TX_ID]);
    assert(sendBody.txHex, 'sendBody.txHex is undefined');
    sendBody.txHex.should.equal('signed-tx-hex');

    const patchCall = services.bridge.calls.find(
      (c) => c.method === 'PATCH' && c.path === `/job/${JOB_ID}`,
    );
    assert(patchCall !== undefined, `expected PATCH /job/${JOB_ID} to be called`);
    const patchBody = patchCall.body as { status: string; result: { txid: string } };
    patchBody.status.should.equal('complete');
    patchBody.result.should.have.property('txid', 'test-tx-id');
  });

  it('PATCHes multisig_sign job failed when request.body is missing walletId', async () => {
    assert(services.bridge, 'bridge service should be defined');
    services.bridge.setPendingJobs([
      makeAwaitingBitgoSignJob({
        request: {
          endpoint: `/api/${COIN}/multisig/sign`,
          method: 'POST',
          body: {
            source: 'user',
            pub: USER_XPUB,
            wpSubmitKind: 'sendMany',
            wpSubmitParams: { recipients: [] },
          },
        },
      }),
    ]);

    await waitForJobCompletion(services.bridge, JOB_ID, 5000);

    const sendCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send'));
    sendCalls.should.have.length(0);

    const patchCall = services.bridge.calls.find(
      (c) => c.method === 'PATCH' && c.path === `/job/${JOB_ID}`,
    );
    assert(patchCall !== undefined, `expected PATCH /job/${JOB_ID} to be called`);
    (patchCall.body as { status: string }).status.should.equal('failed');
  });
});
