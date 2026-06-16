import 'should';
import sinon from 'sinon';
import {
  BridgeJobResponse,
  JobStatus,
} from '../../../masterBitgoExpress/clients/bridgeClient.types';
import { handleGetJob } from '../../../masterBitgoExpress/handlers/handleGetJob';
import { MasterApiSpecRouteRequest } from '../../../masterBitgoExpress/routers/masterBitGoExpressApiSpec';
import { MasterExpressConfig } from '../../../shared/types';
import { DEFAULT_ASYNC_MODE_CONFIG, makeBridgeJob } from './testUtils';

const JOB_ID = 'job-123';

const statusCases: Array<{
  bridgeStatus: JobStatus;
  expectedStatus: string;
  bridgeExtras?: Partial<BridgeJobResponse>;
  expectedExtras?: Record<string, unknown>;
}> = [
  { bridgeStatus: 'awaiting_oso', expectedStatus: 'awaiting_client' },
  { bridgeStatus: 'awaiting_bitgo', expectedStatus: 'awaiting_bitgo' },
  {
    bridgeStatus: 'complete',
    expectedStatus: 'complete',
    bridgeExtras: { result: { walletId: 'wallet-abc' } },
    expectedExtras: { result: { walletId: 'wallet-abc' } },
  },
  {
    bridgeStatus: 'failed',
    expectedStatus: 'failed',
    bridgeExtras: { error: 'signing failed' },
    expectedExtras: { error: 'signing failed' },
  },
  {
    bridgeStatus: 'expired',
    expectedStatus: 'failed',
    expectedExtras: { error: 'Job expired' },
  },
];

function makePollRequest(
  bridgeJob: BridgeJobResponse,
  asyncEnabled = true,
): MasterApiSpecRouteRequest<'v1.wallet.getJob', 'get'> {
  return {
    params: { jobId: JOB_ID },
    config: {
      asyncModeConfig: { ...DEFAULT_ASYNC_MODE_CONFIG, enabled: asyncEnabled },
    } as MasterExpressConfig,
    bridgeClient: {
      getJob: sinon.stub().resolves(bridgeJob),
    },
  } as unknown as MasterApiSpecRouteRequest<'v1.wallet.getJob', 'get'>;
}

describe('handleGetJob', () => {
  for (const { bridgeStatus, expectedStatus, bridgeExtras, expectedExtras } of statusCases) {
    it(`maps ${bridgeStatus} to ${expectedStatus}`, async () => {
      const result = await handleGetJob(
        makePollRequest(makeBridgeJob({ status: bridgeStatus, ...bridgeExtras })),
      );

      result.should.eql({
        jobId: JOB_ID,
        status: expectedStatus,
        ...expectedExtras,
      });
    });
  }

  it('maps currentRound to round and passes totalRounds', async () => {
    const result = await handleGetJob(
      makePollRequest(makeBridgeJob({ status: 'awaiting_bitgo', currentRound: 2, totalRounds: 3 })),
    );

    result.should.eql({
      jobId: JOB_ID,
      status: 'awaiting_bitgo',
      round: 2,
      totalRounds: 3,
    });
  });

  it('omits result when complete but bridge result is undefined', async () => {
    const result = await handleGetJob(makePollRequest(makeBridgeJob({ status: 'complete' })));

    result.should.eql({
      jobId: JOB_ID,
      status: 'complete',
    });
  });

  it('throws when async mode is disabled', async () => {
    await handleGetJob(makePollRequest(makeBridgeJob(), false)).should.be.rejectedWith(
      'Job polling requires async mode',
    );
  });
});
