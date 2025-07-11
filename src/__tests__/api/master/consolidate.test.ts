import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo/sdk-core';
import { Hteth } from '@bitgo/sdk-coin-eth';

describe('POST /api/:coin/wallet/:walletId/consolidate', () => {
  let agent: request.SuperAgentTest;
  const coin = 'hteth';
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

  it('should consolidate account addresses by calling the enclaved express service', async () => {
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

    // Mock sendAccountConsolidations
    const sendConsolidationsStub = sinon
      .stub(Wallet.prototype, 'sendAccountConsolidations')
      .resolves({
        success: [
          {
            txid: 'consolidation-tx-1',
            status: 'signed',
          },
        ],
        failure: [],
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
      });

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(1);
    response.body.success[0].should.have.property('txid', 'consolidation-tx-1');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(sendConsolidationsStub);
  });

  it('should handle partial consolidation failures', async () => {
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

    // Mock sendAccountConsolidations with partial failures
    const sendConsolidationsStub = sinon
      .stub(Wallet.prototype, 'sendAccountConsolidations')
      .resolves({
        success: [
          {
            txid: 'consolidation-tx-1',
            status: 'signed',
          },
        ],
        failure: [
          {
            error: 'Insufficient funds',
            address: '0xfedcba0987654321',
          },
        ],
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
      });

    response.status.should.equal(202);
    response.body.should.deepEqual({
      success: [
        {
          txid: 'consolidation-tx-1',
          status: 'signed',
        },
      ],
      failure: [
        {
          error: 'Insufficient funds',
          address: '0xfedcba0987654321',
        },
      ],
    });

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(sendConsolidationsStub);
  });

  it('should throw error when all consolidations fail', async () => {
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

    // Mock sendAccountConsolidations with all failures
    const sendConsolidationsStub = sinon
      .stub(Wallet.prototype, 'sendAccountConsolidations')
      .resolves({
        success: [],
        failure: [
          {
            error: 'All consolidations failed',
            address: '0x1234567890abcdef',
          },
          {
            error: 'All consolidations failed',
            address: '0xfedcba0987654321',
          },
        ],
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    response.body.should.have.property('details').which.match(/All consolidations failed/);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(sendConsolidationsStub);
  });

  it('should throw error when coin does not support account consolidations', async () => {
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

    // Mock allowsAccountConsolidations to return false
    const allowsConsolidationsStub = sinon
      .stub(Hteth.prototype, 'allowsAccountConsolidations')
      .returns(false);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
      });

    response.status.should.equal(500);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(allowsConsolidationsStub);
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
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'wrong_pubkey',
      });

    response.status.should.equal(500);

    walletGetNock.done();
    keychainGetNock.done();
  });
});
