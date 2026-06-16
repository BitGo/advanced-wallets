import 'should';
import * as request from 'supertest';
import nock from 'nock';
import sinon from 'sinon';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import * as middleware from '../../../shared/middleware';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { BitGoRequest } from '../../../types/request';
import {
  BridgeJobResponse,
  JobStatus,
} from '../../../masterBitgoExpress/clients/bridgeClient.types';
import { DEFAULT_ASYNC_MODE_CONFIG, makeBridgeJob } from './testUtils';

const JOB_ID = 'job-123';
const BRIDGE_URL = 'http://bridge.invalid';
const AWM_URL = 'http://advancedwalletmanager.invalid';

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

describe('GET /api/v1/advancedwallet/job/:jobId', () => {
  let bitgo: BitGoAPI;

  function makeConfig(overrides: Partial<MasterExpressConfig> = {}): MasterExpressConfig {
    return {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: AWM_URL,
      awmServerCaCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG,
      ...overrides,
    };
  }

  function createAsyncAgent() {
    const config = makeConfig({
      asyncModeConfig: {
        enabled: true,
        awmAsyncUrl: BRIDGE_URL,
        pollIntervalInMs: 30000,
        jobTtlInSeconds: 3600,
        jobTtlMpcInSeconds: 7200,
      },
    });

    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).bitgo = bitgo;
      (req as BitGoRequest<MasterExpressConfig>).config = config;
      next();
    });

    return request.agent(expressApp(config));
  }

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    bitgo = new BitGoAPI({ env: 'test' });
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  for (const { bridgeStatus, expectedStatus, bridgeExtras, expectedExtras } of statusCases) {
    it(`returns 200 mapping ${bridgeStatus} to ${expectedStatus}`, async () => {
      const agent = createAsyncAgent();
      const bridgeJob = makeBridgeJob({ status: bridgeStatus, ...bridgeExtras }, JOB_ID);
      const bridgeNock = nock(BRIDGE_URL).get(`/job/${JOB_ID}`).reply(200, bridgeJob);

      const response = await agent.get(`/api/v1/advancedwallet/job/${JOB_ID}`);

      response.status.should.equal(200);
      response.body.should.eql({
        jobId: JOB_ID,
        status: expectedStatus,
        ...expectedExtras,
      });
      bridgeNock.done();
    });
  }

  it('returns 200 with MPC round progress', async () => {
    const agent = createAsyncAgent();
    const bridgeJob = makeBridgeJob(
      { status: 'awaiting_bitgo', currentRound: 2, totalRounds: 3 },
      JOB_ID,
    );
    const bridgeNock = nock(BRIDGE_URL).get(`/job/${JOB_ID}`).reply(200, bridgeJob);

    const response = await agent.get(`/api/v1/advancedwallet/job/${JOB_ID}`);

    response.status.should.equal(200);
    response.body.should.eql({
      jobId: JOB_ID,
      status: 'awaiting_bitgo',
      round: 2,
      totalRounds: 3,
    });
    bridgeNock.done();
  });

  it('returns 404 when bridge job is not found', async () => {
    const agent = createAsyncAgent();

    const bridgeNock = nock(BRIDGE_URL)
      .get(`/job/${JOB_ID}`)
      .reply(404, { message: 'job not found' });

    const response = await agent.get(`/api/v1/advancedwallet/job/${JOB_ID}`);

    response.status.should.equal(404);
    response.body.error.should.equal('NotFoundError');
    response.body.details.should.equal('job not found');
    bridgeNock.done();
  });

  it('returns 400 when async mode is disabled', async () => {
    const config = makeConfig();
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).bitgo = bitgo;
      (req as BitGoRequest<MasterExpressConfig>).config = config;
      next();
    });

    const agent = request.agent(expressApp(config));
    const response = await agent.get(`/api/v1/advancedwallet/job/${JOB_ID}`);

    response.status.should.equal(400);
    response.body.error.should.equal('BadRequestError');
    response.body.details.should.equal('Job polling requires async mode');
  });
});
