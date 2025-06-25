import 'should';
import sinon from 'sinon';

import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo/sdk-core';
import { Coin } from 'bitgo';
import assert from 'assert';

describe('POST /api/:coin/wallet/:walletId/sendmany', () => {
  let agent: request.SuperAgentTest;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const coin = 'tbtc';
  const accessToken = 'test-token';
  const walletId = 'test-wallet-id';

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      enclavedExpressUrl: enclavedExpressUrl,
      enclavedExpressCert: 'dummy-cert',
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

  describe('SendMany Multisig:', () => {
    it('should send many transactions by calling the enclaved express service', async () => {
      // Mock wallet get request
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'onchain',
        });

      // Mock keychain get request
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'user-key-id',
          pub: 'xpub_user',
        });

      const prebuildStub = sinon.stub(Wallet.prototype, 'prebuildTransaction').resolves({
        txHex: 'prebuilt-tx-hex',
        txInfo: {
          nP2SHInputs: 1,
          nSegwitInputs: 0,
          nOutputs: 2,
        },
        walletId,
      });

      const verifyStub = sinon.stub(Coin.Btc.prototype, 'verifyTransaction').resolves(true);

      // Mock enclaved express sign request
      const signNock = nock(enclavedExpressUrl)
        .post(`/api/${coin}/multisig/sign`)
        .reply(200, {
          halfSigned: {
            txHex: 'signed-tx-hex',
            txInfo: {
              nP2SHInputs: 1,
              nSegwitInputs: 0,
              nOutputs: 2,
            },
          },
          walletId: 'test-wallet-id',
          source: 'user',
          pub: 'xpub_user',
        });

      // Mock transaction submit
      const submitNock = nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
        .matchHeader('any', () => true)
        .reply(200, {
          txid: 'test-tx-id',
          status: 'signed',
        });

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/sendMany`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          recipients: [
            {
              address: 'tb1qtest1',
              amount: '100000',
            },
            {
              address: 'tb1qtest2',
              amount: '200000',
            },
          ],
          source: 'user',
          pubkey: 'xpub_user',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('status', 'signed');

      walletGetNock.done();
      sinon.assert.calledOnce(prebuildStub);
      sinon.assert.calledOnce(verifyStub);
      keychainGetNock.done();
      signNock.done();
      submitNock.done();
    });

    it('should handle backup key signing', async () => {
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

      const prebuildStub = sinon.stub(Wallet.prototype, 'prebuildTransaction').resolves({
        txHex: 'prebuilt-tx-hex',
        txInfo: {
          nP2SHInputs: 1,
          nSegwitInputs: 0,
          nOutputs: 2,
        },
        walletId,
      });

      const verifyStub = sinon.stub(Coin.Btc.prototype, 'verifyTransaction').resolves(true);

      // Mock enclaved express sign request
      const signNock = nock(enclavedExpressUrl)
        .post(`/api/${coin}/multisig/sign`)
        .reply(200, {
          halfSigned: {
            txHex: 'signed-tx-hex',
            txInfo: {
              nP2SHInputs: 1,
              nSegwitInputs: 0,
              nOutputs: 2,
            },
          },
          walletId: 'test-wallet-id',
          source: 'backup',
          pub: 'xpub_backup',
        });

      // Mock transaction submit
      const submitNock = nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
        .matchHeader('any', () => true)
        .reply(200, {
          txid: 'test-tx-id',
          status: 'signed',
        });

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/sendMany`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          recipients: [
            {
              address: 'tb1qtest1',
              amount: '100000',
            },
          ],
          source: 'backup',
          pubkey: 'xpub_backup',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('status', 'signed');

      walletGetNock.done();
      sinon.assert.calledOnce(prebuildStub);
      sinon.assert.calledOnce(verifyStub);
      keychainGetNock.done();
      signNock.done();
      submitNock.done();
    });
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
      .post(`/api/${coin}/wallet/${walletId}/sendMany`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        recipients: [
          {
            address: 'tb1qtest1',
            amount: '100000',
          },
        ],
        source: 'user',
        pubkey: 'wrong_pubkey',
      });

    // TODO: Fix this to expect the error message when the middleware on MBE is fixed to handle errors
    response.status.should.equal(500);

    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when enclaved express client is not configured', async () => {
    // Create a config without enclaved express settings
    const invalidConfig: Partial<MasterExpressConfig> = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      tlsMode: TlsMode.DISABLED,
      mtlsRequestCert: false,
      allowSelfSigned: true,
    };

    try {
      expressApp(invalidConfig as MasterExpressConfig);
      assert(false, 'Expected error to be thrown when enclaved express client is not configured');
    } catch (error) {
      (error as Error).message.should.equal(
        'enclavedExpressUrl and enclavedExpressCert are required',
      );
    }
  });

  it('should fail when transaction verification returns false', async () => {
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

    const prebuildStub = sinon.stub(Wallet.prototype, 'prebuildTransaction').resolves({
      txHex: 'prebuilt-tx-hex',
      txInfo: {
        nP2SHInputs: 1,
        nSegwitInputs: 0,
        nOutputs: 2,
      },
      walletId,
    });

    // Mock verifyTransaction to return false
    const verifyStub = sinon.stub(Coin.Btc.prototype, 'verifyTransaction').resolves(false);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/sendMany`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        recipients: [
          {
            address: 'tb1qtest1',
            amount: '100000',
          },
        ],
        source: 'user',
        pubkey: 'xpub_user',
      });

    response.status.should.equal(500);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(prebuildStub);
    sinon.assert.calledOnce(verifyStub);
  });

  it('should fail when transaction verification throws an error', async () => {
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

    const prebuildStub = sinon.stub(Wallet.prototype, 'prebuildTransaction').resolves({
      txHex: 'prebuilt-tx-hex',
      txInfo: {
        nP2SHInputs: 1,
        nSegwitInputs: 0,
        nOutputs: 2,
      },
      walletId,
    });

    // Mock verifyTransaction to throw an error
    const verifyStub = sinon
      .stub(Coin.Btc.prototype, 'verifyTransaction')
      .rejects(new Error('Invalid transaction'));

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/sendMany`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        recipients: [
          {
            address: 'tb1qtest1',
            amount: '100000',
          },
        ],
        source: 'user',
        pubkey: 'xpub_user',
      });

    response.status.should.equal(500);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(prebuildStub);
    sinon.assert.calledOnce(verifyStub);
  });
});
