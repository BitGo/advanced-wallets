import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo-beta/sdk-core';
import { Hteth } from '@bitgo-beta/sdk-coin-eth';
import * as transactionRequests from '../../../masterBitgoExpress/handlers/transactionRequests';
import * as handlerUtils from '../../../masterBitgoExpress/handlers/utils/utils';

describe('POST /api/:coin/wallet/:walletId/consolidate', () => {
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
    };

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should succeed in consolidating multisig wallet addresses', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('onchain'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const mockBuilds = [
      {
        walletId,
        txHex: 'unsigned-tx-hex-1',
        txInfo: { unspents: [] },
        feeInfo: { fee: 1000 },
      },
      {
        walletId,
        txHex: 'unsigned-tx-hex-2',
        txInfo: { unspents: [] },
        feeInfo: { fee: 1500 },
      },
    ];

    const buildConsolidationsStub = sinon
      .stub(Wallet.prototype, 'buildAccountConsolidations')
      .resolves(mockBuilds);

    const sendAccountConsolidationStub = sinon
      .stub(Wallet.prototype, 'sendAccountConsolidation')
      .resolves({
        txid: 'consolidation-tx-1',
        status: 'signed',
      });

    const makeCustomSigningFunctionStub = sinon
      .stub(handlerUtils, 'makeCustomSigningFunction')
      .returns(() => Promise.resolve({ txHex: 'signed-tx-hex' }));

    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(true);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(2);
    response.body.should.have.property('failure');
    response.body.failure.should.have.length(0);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(buildConsolidationsStub);
    sinon.assert.calledTwice(sendAccountConsolidationStub);
    sinon.assert.calledTwice(makeCustomSigningFunctionStub);
    sinon.assert.calledOnce(allowsConsolidationsStub);
  });

  it('should succeed in consolidating MPC wallet using signAndSendTxRequests', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('tss'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { ...mockUserKeychain, commonKeychain: 'user-common-key' });

    const mockMpcBuild = {
      walletId,
      txHex: 'unsigned-mpc-tx-hex-1',
      txInfo: { unspents: [] },
      feeInfo: { fee: 2000 },
      txRequestId: 'mpc-tx-request-1',
    };

    const buildConsolidationsStub = sinon
      .stub(Wallet.prototype, 'buildAccountConsolidations')
      .resolves([mockMpcBuild]);

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

    const signAndSendTxRequestsStub = sinon
      .stub(transactionRequests, 'signAndSendTxRequests')
      .resolves({
        txid: 'mpc-consolidation-tx-1',
        status: 'signed',
        state: 'signed',
      });

    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(true);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      commonKeychain: 'user-common-key',
      consolidateAddresses: ['0x1234567890abcdef'],
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(1);
    response.body.success[0].should.have.property('txid', 'mpc-consolidation-tx-1');
    response.body.should.have.property('failure');
    response.body.failure.should.have.length(0);

    walletGetNock.done();
    keychainGetNock.done();
    getTxRequestNock.done();
    sinon.assert.calledOnce(buildConsolidationsStub);
    sinon.assert.calledOnce(signAndSendTxRequestsStub);
    sinon.assert.calledOnce(allowsConsolidationsStub);
  });

  it('should succeed in consolidating with backup key', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('onchain'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);

    const mockBuild = {
      walletId,
      txHex: 'unsigned-tx-hex-backup',
      txInfo: { unspents: [] },
      feeInfo: { fee: 1200 },
    };

    const buildConsolidationsStub = sinon
      .stub(Wallet.prototype, 'buildAccountConsolidations')
      .resolves([mockBuild]);

    const sendAccountConsolidationStub = sinon
      .stub(Wallet.prototype, 'sendAccountConsolidation')
      .resolves({
        txid: 'backup-consolidation-tx',
        status: 'signed',
      });

    const makeCustomSigningFunctionStub = sinon
      .stub(handlerUtils, 'makeCustomSigningFunction')
      .returns(() => Promise.resolve({ txHex: 'signed-tx-hex' }));

    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(true);

    const requestPayload = {
      pubkey: mockBackupKeychain.pub,
      source: 'backup' as const,
      consolidateAddresses: ['0x1234567890abcdef'],
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(1);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(buildConsolidationsStub);
    sinon.assert.calledOnce(sendAccountConsolidationStub);
    sinon.assert.calledOnce(makeCustomSigningFunctionStub);
    sinon.assert.calledOnce(allowsConsolidationsStub);
  });

  it('should fail when wallet is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Wallet not found', name: 'WalletNotFoundError' });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('onchain'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(false);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(allowsConsolidationsStub);
  });

  it('should fail when required pubkey parameter is missing', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
    const response = await agent.post(`/api/${coin}/wallet/${walletId}/consolidate`).send({
      pubkey: mockUserKeychain.pub,
      source: 'user',
      consolidateAddresses: ['0x1234567890abcdef'],
    });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when partial multisig consolidation failures occur', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('onchain'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const mockBuilds = [
      { walletId, txHex: 'unsigned-tx-hex-1' },
      { walletId, txHex: 'unsigned-tx-hex-2' },
    ];

    const buildConsolidationsStub = sinon
      .stub(Wallet.prototype, 'buildAccountConsolidations')
      .resolves(mockBuilds);

    const sendAccountConsolidationStub = sinon.stub(Wallet.prototype, 'sendAccountConsolidation');
    sendAccountConsolidationStub.onFirstCall().resolves({
      txid: 'consolidation-tx-1',
      status: 'signed',
    });
    sendAccountConsolidationStub.onSecondCall().rejects(new Error('Insufficient funds'));

    const makeCustomSigningFunctionStub = sinon
      .stub(handlerUtils, 'makeCustomSigningFunction')
      .returns(() => Promise.resolve({ txHex: 'signed-tx-hex' }));

    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(true);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(buildConsolidationsStub);
    sinon.assert.calledTwice(sendAccountConsolidationStub);
    sinon.assert.calledTwice(makeCustomSigningFunctionStub);
    sinon.assert.calledOnce(allowsConsolidationsStub);
  });

  it('should fail when all consolidations fail', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData('onchain'));

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const mockBuilds = [
      { walletId, txHex: 'unsigned-tx-hex-1' },
      { walletId, txHex: 'unsigned-tx-hex-2' },
    ];

    const buildConsolidationsStub = sinon
      .stub(Wallet.prototype, 'buildAccountConsolidations')
      .resolves(mockBuilds);

    const sendAccountConsolidationStub = sinon
      .stub(Wallet.prototype, 'sendAccountConsolidation')
      .rejects(new Error('All consolidations failed'));

    const makeCustomSigningFunctionStub = sinon
      .stub(handlerUtils, 'makeCustomSigningFunction')
      .returns(() => Promise.resolve({ txHex: 'signed-tx-hex' }));

    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(true);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    response.body.should.have.property('details').which.match(/All consolidations failed/);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(buildConsolidationsStub);
    sinon.assert.calledTwice(sendAccountConsolidationStub);
    sinon.assert.calledTwice(makeCustomSigningFunctionStub);
    sinon.assert.calledOnce(allowsConsolidationsStub);
  });

  it('should fail when consolidateAddresses parameter is not an array', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
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
