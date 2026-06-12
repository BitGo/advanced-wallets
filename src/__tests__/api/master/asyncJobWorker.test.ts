import 'should';
import nock from 'nock';
import sinon from 'sinon';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { Environments } from '@bitgo-beta/sdk-core';
import { OsoBridgeClient } from '../../../masterBitgoExpress/clients/bridgeClient';
import { BridgeJobResponse } from '../../../masterBitgoExpress/clients/bridgeClient.types';
import {
  startAsyncJobWorker,
  processPendingJobs,
  handleKeyGenerationOperation,
} from '../../../masterBitgoExpress/workers/asyncJobWorker';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { DEFAULT_ASYNC_MODE_CONFIG } from './testUtils';

const BRIDGE_URL = 'http://bridge.invalid';
const BITGO_API_URL = Environments.test.uri;
const COIN = 'tbtc';
const POLL_INTERVAL_MS = 1000;

function makeUserKeychain() {
  return {
    id: 'user-key-id',
    pub: 'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH',
    encryptedPrv: 'encrypted-user-prv',
    type: 'independent' as const,
    source: 'user' as const,
    coin: COIN,
  };
}

function makeBackupKeychain() {
  return {
    id: 'backup-key-id',
    pub: 'xpub661MyMwAqRbcFnihegj1Mo2ePZoMQyLbBYpW7gDXZ7qzqxF3FBAkNAP8Gki8Mxx2BVLjN3RRa75pt5apD2g3ewXPrCfdssAJ7VupXqucLsb',
    encryptedPrv: 'encrypted-backup-prv',
    type: 'independent' as const,
    source: 'backup' as const,
    coin: COIN,
  };
}

function awmOk(body: Record<string, unknown>) {
  return { status: 200, body };
}

function makeJob(overrides: Partial<BridgeJobResponse> = {}): BridgeJobResponse {
  return {
    jobId: 'job-123',
    status: 'awaiting_bitgo',
    version: 1,
    coin: COIN,
    operationType: 'multisig_keygen',
    awmResponse: awmOk({ ...makeUserKeychain() }),
    awmBackupResponse: awmOk({ ...makeBackupKeychain() }),
    request: { body: { label: 'test-wallet', enterprise: 'test-enterprise' } },
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

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
    advancedWalletManagerUrl: 'http://awm.invalid',
    awmServerCaCert: 'dummy-cert',
    tlsMode: TlsMode.DISABLED,
    clientCertAllowSelfSigned: true,
    bitgoAccessToken: 'test-access-token',
    asyncModeConfig: {
      ...DEFAULT_ASYNC_MODE_CONFIG,
      enabled: true,
      awmAsyncUrl: BRIDGE_URL,
      pollIntervalInMs: POLL_INTERVAL_MS,
    },
    ...overrides,
  };
}

function nockBitgoKeychainRegistration(options: {
  pub: string;
  source: 'user' | 'backup';
  keyId: string;
}) {
  return nock(BITGO_API_URL)
    .post(
      `/api/v2/${COIN}/key`,
      (body) => body.pub === options.pub && body.source === options.source,
    )
    .matchHeader('any', () => true)
    .reply(200, { id: options.keyId, pub: options.pub, source: options.source });
}

function nockBitgoKeyCreate(keyId: string) {
  return nock(BITGO_API_URL)
    .post(`/api/v2/${COIN}/key`, (body) => body.source === 'bitgo')
    .matchHeader('any', () => true)
    .reply(200, { id: keyId, pub: 'xpub_bitgo', source: 'bitgo' });
}

function nockWalletAdd(walletId: string) {
  return nock(BITGO_API_URL)
    .post(`/api/v2/${COIN}/wallet/add`)
    .matchHeader('any', () => true)
    .reply(200, {
      id: walletId,
      coin: COIN,
      label: 'test-wallet',
      keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
    });
}

function nockUpdateJobFailed(jobId: string) {
  return nock(BRIDGE_URL)
    .patch(`/job/${jobId}`, (body) => body.status === 'failed')
    .reply(204);
}

function nockUpdateJobComplete(jobId: string, walletId: string) {
  return nock(BRIDGE_URL)
    .patch(
      `/job/${jobId}`,
      (body) => body.status === 'complete' && body.result?.walletId === walletId,
    )
    .reply(204);
}

describe('asyncJobWorker', () => {
  let bitgo: BitGoAPI;
  let bridge: OsoBridgeClient;

  before(() => {
    nock.disableNetConnect();
  });

  after(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    bitgo = new BitGoAPI({ env: 'test', accessToken: 'test-access-token' });
    bridge = new OsoBridgeClient(BRIDGE_URL, 60000);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  describe('startAsyncJobWorker()', () => {
    it('starts polling at the configured interval', async () => {
      const clock = sinon.useFakeTimers();

      const listJobsNock = nock(BRIDGE_URL)
        .get('/jobs')
        .query({ status: 'awaiting_bitgo' })
        .reply(200, { jobs: [] });

      startAsyncJobWorker(makeConfig());

      await clock.tickAsync(POLL_INTERVAL_MS);

      listJobsNock.done();
      clock.restore();
    });

    it('does not fire a second handler job while the first is still running', async () => {
      const clock = sinon.useFakeTimers();
      let callCount = 0;

      nock(BRIDGE_URL)
        .get('/jobs')
        .query({ status: 'awaiting_bitgo' })
        .times(1)
        .reply(200, () => {
          callCount++;
          return { jobs: [] };
        });

      startAsyncJobWorker(makeConfig());

      await clock.tickAsync(POLL_INTERVAL_MS * 3);

      callCount.should.equal(1);
      clock.restore();
    });
  });

  describe('processPendingJobs()', () => {
    it('returns early when no awaiting_bitgo jobs exist', async () => {
      const n = nock(BRIDGE_URL)
        .get('/jobs')
        .query({ status: 'awaiting_bitgo' })
        .reply(200, { jobs: [] });

      await processPendingJobs(bridge, bitgo).should.be.fulfilled();

      n.done();
    });

    it('processes all returned jobs', async () => {
      const job1 = makeJob({ jobId: 'job-1' });
      const job2 = makeJob({ jobId: 'job-2' });

      nock(BRIDGE_URL)
        .get('/jobs')
        .query({ status: 'awaiting_bitgo' })
        .reply(200, { jobs: [job1, job2] });

      nockBitgoKeychainRegistration({
        pub: makeUserKeychain().pub,
        source: 'user',
        keyId: 'user-key-id',
      });
      nockBitgoKeychainRegistration({
        pub: makeBackupKeychain().pub,
        source: 'backup',
        keyId: 'backup-key-id',
      });
      nockBitgoKeyCreate('bitgo-key-id');
      nockWalletAdd('wallet-1');
      nockUpdateJobComplete('job-1', 'wallet-1');

      nockBitgoKeychainRegistration({
        pub: makeUserKeychain().pub,
        source: 'user',
        keyId: 'user-key-id',
      });
      nockBitgoKeychainRegistration({
        pub: makeBackupKeychain().pub,
        source: 'backup',
        keyId: 'backup-key-id',
      });
      nockBitgoKeyCreate('bitgo-key-id');
      nockWalletAdd('wallet-2');
      nockUpdateJobComplete('job-2', 'wallet-2');

      await processPendingJobs(bridge, bitgo).should.be.fulfilled();

      nock.pendingMocks().should.have.length(0);
    });

    it('continues processing remaining jobs when one fails', async () => {
      const badJob = makeJob({
        jobId: 'job-bad',
        awmResponse: { status: 200, body: {} },
      });
      const goodJob = makeJob({ jobId: 'job-good' });

      nock(BRIDGE_URL)
        .get('/jobs')
        .query({ status: 'awaiting_bitgo' })
        .reply(200, { jobs: [badJob, goodJob] });

      nockUpdateJobFailed('job-bad');

      nockBitgoKeychainRegistration({
        pub: makeUserKeychain().pub,
        source: 'user',
        keyId: 'user-key-id',
      });
      nockBitgoKeychainRegistration({
        pub: makeBackupKeychain().pub,
        source: 'backup',
        keyId: 'backup-key-id',
      });
      nockBitgoKeyCreate('bitgo-key-id');
      nockWalletAdd('wallet-good');
      nockUpdateJobComplete('job-good', 'wallet-good');

      await processPendingJobs(bridge, bitgo).should.be.fulfilled();

      nock.pendingMocks().should.have.length(0);
    });

    it('skips jobs with unknown operationType', async () => {
      const job = makeJob({ operationType: 'multisig_sign' });

      const n = nock(BRIDGE_URL)
        .get('/jobs')
        .query({ status: 'awaiting_bitgo' })
        .reply(200, { jobs: [job] });

      await processPendingJobs(bridge, bitgo).should.be.fulfilled();

      n.done();
    });
  });

  describe('handleKeyGenerationOperation()', () => {
    it('registers keychains, creates wallet, and PATCHes job complete', async () => {
      const job = makeJob();
      const walletId = 'new-wallet-id';

      const userKeyNock = nockBitgoKeychainRegistration({
        pub: makeUserKeychain().pub,
        source: 'user',
        keyId: 'user-key-id',
      });
      const backupKeyNock = nockBitgoKeychainRegistration({
        pub: makeBackupKeychain().pub,
        source: 'backup',
        keyId: 'backup-key-id',
      });
      const bitgoKeyNock = nockBitgoKeyCreate('bitgo-key-id');
      const walletNock = nockWalletAdd(walletId);
      const updateNock = nockUpdateJobComplete(job.jobId, walletId);

      await handleKeyGenerationOperation(job, bridge, bitgo);

      userKeyNock.done();
      backupKeyNock.done();
      bitgoKeyNock.done();
      walletNock.done();
      updateNock.done();
    });

    it('throws when awmResponse is missing', async () => {
      const job = makeJob({ awmResponse: undefined });

      await handleKeyGenerationOperation(job, bridge, bitgo).should.be.rejected();
    });

    it('throws when awmBackupResponse is missing', async () => {
      const job = makeJob({ awmBackupResponse: undefined });

      await handleKeyGenerationOperation(job, bridge, bitgo).should.be.rejected();
    });

    it('throws when awmResponse is not a valid AwmResponse envelope', async () => {
      const job = makeJob({
        awmResponse: { unexpected: 'shape' } as unknown as BridgeJobResponse['awmResponse'],
      });

      await handleKeyGenerationOperation(job, bridge, bitgo).should.be.rejected();
    });

    it('throws when WP keychain registration fails', async () => {
      const job = makeJob();

      nock(BITGO_API_URL)
        .post(`/api/v2/${COIN}/key`)
        .matchHeader('any', () => true)
        .reply(500, { message: 'internal server error' });

      await handleKeyGenerationOperation(job, bridge, bitgo).should.be.rejected();
    });

    it('throws when wallet creation fails', async () => {
      const job = makeJob();

      nockBitgoKeychainRegistration({ pub: 'xpub_user', source: 'user', keyId: 'user-key-id' });
      nockBitgoKeychainRegistration({
        pub: 'xpub_backup',
        source: 'backup',
        keyId: 'backup-key-id',
      });
      nockBitgoKeyCreate('bitgo-key-id');

      nock(BITGO_API_URL)
        .post(`/api/v2/${COIN}/wallet/add`)
        .matchHeader('any', () => true)
        .reply(500, { message: 'wallet creation failed' });

      await handleKeyGenerationOperation(job, bridge, bitgo).should.be.rejected();
    });

    it('uses enterprise from request body when provided', async () => {
      const job = makeJob({
        request: { body: { label: 'ent-wallet', enterprise: 'my-enterprise' } },
      });
      const walletId = 'ent-wallet-id';

      nockBitgoKeychainRegistration({
        pub: makeUserKeychain().pub,
        source: 'user',
        keyId: 'user-key-id',
      });
      nockBitgoKeychainRegistration({
        pub: makeBackupKeychain().pub,
        source: 'backup',
        keyId: 'backup-key-id',
      });

      nock(BITGO_API_URL)
        .post(
          `/api/v2/${COIN}/key`,
          (body) => body.source === 'bitgo' && body.enterprise === 'my-enterprise',
        )
        .matchHeader('any', () => true)
        .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo', source: 'bitgo' });

      nockWalletAdd(walletId);
      nockUpdateJobComplete(job.jobId, walletId);

      await handleKeyGenerationOperation(job, bridge, bitgo);

      nock.pendingMocks().should.have.length(0);
    });
  });
});
