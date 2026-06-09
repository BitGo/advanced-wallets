import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments } from '@bitgo-beta/sdk-core';
import { Hteth } from '@bitgo-beta/sdk-coin-eth';
import * as transactionRequests from '../../../masterBitgoExpress/handlers/transactionRequests';
import { BitGoAPITestHarness, DEFAULT_ASYNC_MODE_CONFIG } from './testUtils';

describe('POST /api/v1/:coin/advancedwallet/:walletId/consolidate', () => {
  let agent: request.SuperAgentTest;
  const coin = 'hteth';
  const walletId = 'test-wallet-id';
  const accessToken = 'test-access-token';
  const bitgoApiUrl = Environments.test.uri;
  const advancedWalletManagerUrl = 'https://test-advanced-wallet-manager.com';

  const mockWalletData = (multisigType: 'onchain' | 'tss') => ({
    id: walletId,
    type: 'advanced',
    keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
    coin: coin,
    label: 'Test Wallet',
    multisigType,
  });

  const mockUserKeychain = {
    id: 'user-key-id',
    pub: 'xpub661MyMwAqRbcFkPHucMnrGNzDwb6teAX1RbKQmqtEF8kK3Z7LZ59qafCjB9eCWzSgHCZkdXgp',
    type: 'independent',
  };

  const mockBackupKeychain = {
    id: 'backup-key-id',
    pub: 'xpub661MyMwAqRbcGaZrYqfYmaTRzQxM9PKEZ7GRb6DKfghkzgjk2dKT4qBXfz6WzpT4N5fXJhFW',
    type: 'independent',
  };

  const mockBitgoKeychain = {
    id: 'bitgo-key-id',
    pub: 'xpub661MyMwAqRbcHtYNxRNuEtDFmPMRzBVPDfBXNu2RUBVFNz8MnWQgkrMZCNB',
    type: 'bitgo',
  };

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 30000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: advancedWalletManagerUrl,
      awmServerCaCert: 'test-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG,
    };

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    BitGoAPITestHarness.clearConstantsCache();
  });

  // Nocks wallet and all 3 keychains
  function nockWalletAndKeychains(multisigType: 'onchain' | 'tss') {
    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData(multisigType));

    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBitgoKeychain);
  }

  it('should succeed in consolidating multisig wallet addresses', async () => {
    nockWalletAndKeychains('onchain');

    const mockBuilds = [
      { consolidateId: 'consolidate-1', walletId, txHex: '0xabc111' },
      { consolidateId: 'consolidate-2', walletId, txHex: '0xabc222' },
    ];

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateAccount/build`)
      .reply(200, mockBuilds);

    sinon.stub(Hteth.prototype, 'verifyTransaction').resolves(true);

    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .times(2)
      .reply(200, { halfSigned: { txHex: 'signed-eth-tx' } });

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .times(2)
      .reply(200, { txid: 'consolidation-tx-1', status: 'signed' });

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(2);
    response.body.should.have.property('failure');
    response.body.failure.should.have.length(0);
  });

  it('should succeed in consolidating MPC wallet using signAndSendTxRequests', async () => {
    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('tss'));

    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { ...mockUserKeychain, commonKeychain: 'user-common-key' });
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBitgoKeychain);

    const mockMpcBuild = {
      walletId,
      txHex: 'unsigned-mpc-tx-hex-1',
      txInfo: { unspents: [] },
      feeInfo: { fee: 2000 },
      txRequestId: 'mpc-tx-request-1',
    };

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateAccount/build`)
      .reply(200, [mockMpcBuild]);

    const getTxRequestNock = nock(bitgoApiUrl)
      .get(`/api/v2/wallet/${walletId}/txrequests`)
      .query({ txRequestIds: 'mpc-tx-request-1', latest: 'true' })
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, {
        txRequests: [
          {
            txRequestId: 'mpc-tx-request-1',
            version: 1,
            latest: true,
            state: 'pendingUserSignature',
            transactions: [],
            walletId: walletId,
            walletType: 'cold',
            date: new Date().toISOString(),
            userId: 'test-user-id',
            enterpriseId: 'test-enterprise-id',
            intent: { intentType: 'payment' },
            txHashes: [],
            policiesChecked: false,
            unsignedTxs: [],
          },
        ],
      });

    // TSS MPC signing flow is tested in signAndSendTxRequest.test.ts
    const signAndSendTxRequestsStub = sinon
      .stub(transactionRequests, 'signAndSendTxRequests')
      .resolves({
        txid: 'mpc-consolidation-tx-1',
        status: 'signed',
        state: 'signed',
      });

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      commonKeychain: 'user-common-key',
      consolidateAddresses: ['0x1234567890abcdef'],
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(1);
    response.body.success[0].should.have.property('txid', 'mpc-consolidation-tx-1');
    response.body.should.have.property('failure');
    response.body.failure.should.have.length(0);

    getTxRequestNock.done();
    sinon.assert.calledOnce(signAndSendTxRequestsStub);
  });

  it('should succeed in consolidating with backup key', async () => {
    nockWalletAndKeychains('onchain');

    const mockBuild = { consolidateId: 'consolidate-backup-1', walletId, txHex: '0xabc333' };

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateAccount/build`)
      .reply(200, [mockBuild]);

    sinon.stub(Hteth.prototype, 'verifyTransaction').resolves(true);

    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, { halfSigned: { txHex: 'signed-eth-tx' } });

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .reply(200, { txid: 'backup-consolidation-tx', status: 'signed' });

    const requestPayload = {
      pubkey: mockBackupKeychain.pub,
      source: 'backup' as const,
      consolidateAddresses: ['0x1234567890abcdef'],
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(1);
  });

  it('should fail when wallet is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Wallet not found', name: 'WalletNotFoundError' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(404);
    response.body.should.have.property('error');
    walletGetNock.done();
  });

  it('should fail when signing keychain is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('onchain'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Keychain not found', name: 'KeychainNotFoundError' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(404);
    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when provided pubkey does not match wallet keychain', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('onchain'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 'xpub661MyMwAqRbcWRONG_PUBKEY_THAT_DOES_NOT_MATCH',
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when coin does not support account consolidations', async () => {
    nockWalletAndKeychains('onchain');

    // hteth natively returns true so this is stubbed to test the negative path
    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(false);

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property(
      'details',
      'Invalid coin selected - account consolidations not supported',
    );

    sinon.assert.calledOnce(allowsConsolidationsStub);
  });

  it('should fail when required pubkey parameter is missing', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when required source parameter is missing', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.match(/Invalid value undefined supplied/);
  });

  it('should fail when source parameter has invalid value', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'invalid_source',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.match(/Invalid value "invalid_source"/);
  });

  it('should fail when authorization header is missing', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when partial multisig consolidation failures occur', async () => {
    nockWalletAndKeychains('onchain');

    const mockBuilds = [
      { consolidateId: 'consolidate-1', walletId, txHex: '0xabc111' },
      { consolidateId: 'consolidate-2', walletId, txHex: '0xabc222' },
    ];

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateAccount/build`)
      .reply(200, mockBuilds);

    sinon.stub(Hteth.prototype, 'verifyTransaction').resolves(true);

    // First consolidation succeeds, second fails at AWM
    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, { halfSigned: { txHex: 'signed-eth-tx' } });
    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(500, { error: 'Internal Server Error', details: 'Insufficient funds' });

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .reply(200, { txid: 'consolidation-tx-1', status: 'signed' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have
      .property('details')
      .which.match(/Consolidations failed: 1 and succeeded: 1/);
  });

  it('should fail when all consolidations fail', async () => {
    nockWalletAndKeychains('onchain');

    const mockBuilds = [
      { consolidateId: 'consolidate-1', walletId, txHex: '0xabc111' },
      { consolidateId: 'consolidate-2', walletId, txHex: '0xabc222' },
    ];

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateAccount/build`)
      .reply(200, mockBuilds);

    sinon.stub(Hteth.prototype, 'verifyTransaction').resolves(true);

    // Both consolidations fail at AWM
    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .times(2)
      .reply(500, { error: 'Internal Server Error', details: 'All consolidations failed' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    response.body.should.have.property('details').which.match(/All consolidations failed/);
  });

  it('should fail when consolidateAddresses parameter is not an array', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: 'not-an-array',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.match(/Invalid value "not-an-array"/);
  });

  it('should fail when apiVersion parameter has invalid value', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        apiVersion: 'invalid_version',
        consolidateAddresses: ['0x1234567890abcdef'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.match(/Invalid value "invalid_version"/);
  });
});
