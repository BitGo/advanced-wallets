import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo-beta/sdk-core';

describe('POST /api/:coin/wallet/:walletId/accelerate', () => {
  let agent: request.SuperAgentTest;
  const coin = 'tbtc';
  const walletId = 'test-wallet-id';
  const accessToken = 'test-access-token';
  const bitgoApiUrl = Environments.test.uri;
  const advancedWalletManagerUrl = 'https://test-advanced-wallet-manager.com';

  const mockWalletData = {
    id: walletId,
    type: 'cold',
    subType: 'onPrem',
    keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
    coin: coin,
    label: 'Test Wallet',
  };

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
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 30000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: advancedWalletManagerUrl,
      advancedWalletManagerCert: 'test-cert',
      tlsMode: TlsMode.DISABLED,
      allowSelfSigned: true,
    };

    const app = advancedWalletManagerApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should succeed in accelerating transaction with CPFP using user key', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const accelerateTransactionStub = sinon
      .stub(Wallet.prototype, 'accelerateTransaction')
      .resolves({
        txid: 'accelerated-tx-id-123',
        tx: '0100000001abcdef...',
        status: 'signed',
        hash: 'accelerated-tx-id-123',
      });

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
      cpfpFeeRate: 50,
      maxFee: 10000,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'accelerated-tx-id-123');
    response.body.should.have.property('tx', '0100000001abcdef...');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(accelerateTransactionStub);

    const callArgs = accelerateTransactionStub.firstCall.args[0];
    callArgs!.should.have.property('cpfpTxIds');
    callArgs!.should.have.property('cpfpFeeRate', 50);
    callArgs!.should.have.property('maxFee', 10000);
    callArgs!.should.have.property('customSigningFunction');
    callArgs!.should.have.property('reqId');
  });

  it('should succeed in accelerating transaction with RBF using backup key', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);

    const accelerateTransactionStub = sinon
      .stub(Wallet.prototype, 'accelerateTransaction')
      .resolves({
        txid: 'rbf-accelerated-tx-id',
        tx: '0100000001fedcba...',
      });

    const requestPayload = {
      pubkey: mockBackupKeychain.pub,
      source: 'backup' as const,
      rbfTxIds: ['a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890'],
      feeMultiplier: 1.5,
      maxFee: 15000,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'rbf-accelerated-tx-id');
    response.body.should.have.property('tx', '0100000001fedcba...');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(accelerateTransactionStub);
  });

  it('should succeed in accelerating transaction with all optional parameters', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const accelerateTransactionStub = sinon
      .stub(Wallet.prototype, 'accelerateTransaction')
      .resolves({
        txid: 'accelerated-with-all-params',
        tx: '0100000001abcdef123...',
      });

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      cpfpTxIds: ['tx1', 'tx2'],
      cpfpFeeRate: 100,
      maxFee: 20000,
      rbfTxIds: ['tx3', 'tx4'],
      feeMultiplier: 2.0,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'accelerated-with-all-params');
    response.body.should.have.property('tx', '0100000001abcdef123...');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(accelerateTransactionStub);
  });

  it('should fail when wallet is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Wallet not found', name: 'WalletNotFoundError' });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(404);
    response.body.should.have.property('error');
    walletGetNock.done();
  });

  it('should fail when signing keychain is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Keychain not found', name: 'KeychainNotFoundError' });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(404);
    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when provided pubkey does not match wallet keychain', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 'xpub661MyMwAqRbcWRONG_PUBKEY_THAT_DOES_NOT_MATCH',
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when required pubkey parameter is missing', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when required source parameter is missing', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when source parameter has invalid value', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'invalid_source',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when authorization header is missing', async () => {
    const response = await agent.post(`/api/${coin}/wallet/${walletId}/accelerate`).send({
      pubkey: mockUserKeychain.pub,
      source: 'user',
      cpfpTxIds: ['test-tx-id'],
    });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when accelerateTransaction throws an error', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const accelerateTransactionStub = sinon
      .stub(Wallet.prototype, 'accelerateTransaction')
      .rejects(new Error('Insufficient funds for acceleration'));

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
        cpfpFeeRate: 100,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('name', 'Error');
    response.body.should.have.property('details', 'Insufficient funds for acceleration');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(accelerateTransactionStub);
  });

  it('should fail when cpfpTxIds parameter is not an array', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: 'not-an-array',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when rbfTxIds parameter is not an array', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        rbfTxIds: 'not-an-array',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when pubkey parameter is not a string', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 12345,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when both cpfpTxIds and rbfTxIds are missing', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });
});
