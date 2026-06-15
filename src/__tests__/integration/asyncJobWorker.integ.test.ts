import 'should';
import assert from 'assert';
import { startServices, IntegServices } from './helpers/setup';
import { BridgeJobResponse } from '../../masterBitgoExpress/clients/bridgeClient.types';
import { MockBridgeServer } from './helpers/mockBridgeServer';

const COIN = 'tbtc';

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
    jobId: 'integ-job-123',
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
    const jobId = 'integ-job-123';
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
    const jobId = 'integ-job-123';
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
});
