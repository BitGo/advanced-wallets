import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo-beta/sdk-core';

describe('POST /api/:coin/wallet/:walletId/accelerate', () => {
  let agent: request.SuperAgentTest;
  const coin = 'tbtc';
  const walletId = 'test-wallet-id';
  const accessToken = 'test-access-token';
  const bitgoApiUrl = Environments.test.uri;
  const enclavedExpressUrl = 'https://test-enclaved-express.com';

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 30000,
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      enclavedExpressUrl: enclavedExpressUrl,
      enclavedExpressCert: 'test-cert',
      tlsMode: TlsMode.DISABLED,
      mtlsRequestCert: false,
      allowSelfSigned: true,
    };

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should accelerate transaction by calling the enclaved express service', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    // Mock keychain get request
    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
      });

    // Mock accelerateTransaction
    const accelerateTransactionStub = sinon
      .stub(Wallet.prototype, 'accelerateTransaction')
      .resolves({
        txid: 'accelerated-tx-id',
        tx: 'accerated-transaction-hex',
        status: 'signed',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
        cpfpFeeRate: 50,
        maxFee: 10000,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'accelerated-tx-id');
    response.body.should.have.property('status', 'signed');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(accelerateTransactionStub);
  });

  it('should handle acceleration with backup key signing', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    // Mock keychain get request for backup key
    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'backup-key-id',
        pub: 'xpub_backup',
      });

    // Mock accelerateTransaction
    const accelerateTransactionStub = sinon
      .stub(Wallet.prototype, 'accelerateTransaction')
      .resolves({
        txid: 'accelerated-tx-id',
        status: 'signed',
        tx: 'accelerated-transaction-hex',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'backup',
        pubkey: 'xpub_backup',
        rbfTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
        feeMultiplier: 1.5,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'accelerated-tx-id');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(accelerateTransactionStub);
  });

  it('should throw error when wallet not found', async () => {
    // Mock wallet get request to return 404
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(404, { error: 'Wallet not found' });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
      });

    response.status.should.equal(404);
    response.body.should.have.property('error');

    walletGetNock.done();
  });

  it('should throw error when signing keychain not found', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    // Mock keychain get request to return 404
    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(404, { error: 'Keychain not found' });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
      });

    response.status.should.equal(404);
    response.body.should.have.property('error');

    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should throw error when provided pubkey does not match wallet keychain', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    // Mock keychain get request
    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'wrong_pubkey',
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');

    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should handle acceleration with additional parameters', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    // Mock keychain get request
    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
      });

    // Mock accelerateTransaction
    const accelerateTransactionStub = sinon
      .stub(Wallet.prototype, 'accelerateTransaction')
      .resolves({
        txid: 'accelerated-tx-id',
        status: 'signed',
        tx: 'accelerated-transaction-hex',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
        cpfpFeeRate: 100,
        maxFee: 20000,
        feeMultiplier: 2.0,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'accelerated-tx-id');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(accelerateTransactionStub);
  });
});
