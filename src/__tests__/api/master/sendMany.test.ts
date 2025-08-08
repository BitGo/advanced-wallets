import 'should';
import sinon from 'sinon';

import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo-beta/sdk-core';
import { Tbtc } from '@bitgo-beta/sdk-coin-btc';
import assert from 'assert';

describe('POST /api/:coin/wallet/:walletId/sendmany', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const accessToken = 'test-token';
  const walletId = 'test-wallet-id';
  const coin = 'tbtc';

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: advancedWalletManagerUrl,
      awmServerCaCert: 'dummy-cert',
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

  describe('SendMany Multisig:', () => {
    const coin = 'tbtc';
    it('should send many transactions by calling the advanced wallet manager service', async () => {
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

      const verifyStub = sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

      // Mock advanced wallet manager sign request
      const signNock = nock(advancedWalletManagerUrl)
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

      const verifyStub = sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

      // Mock advanced wallet manager sign request
      const signNock = nock(advancedWalletManagerUrl)
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

  describe('SendMany TSS EDDSA:', () => {
    const coin = 'tsol';
    it('should send many transactions using EDDSA TSS signing', async () => {
      // Mock wallet get request for TSS wallet
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
        });

      // Mock keychain get request for TSS keychain
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'user-key-id',
          pub: 'xpub_user',
          commonKeychain: 'test-common-keychain',
          source: 'user',
          type: 'tss',
        });
      const sendManyStub = sinon.stub(Wallet.prototype, 'sendMany').resolves({
        txRequest: {
          txRequestId: 'test-tx-request-id',
          state: 'signed',
          apiVersion: 'full',
          pendingApprovalId: 'test-pending-approval-id',
          transactions: [
            {
              state: 'signed',
              unsignedTx: {
                derivationPath: 'm/0',
                signableHex: 'testMessage',
                serializedTxHex: 'testSerializedTxHex',
              },
              signatureShares: [],
              signedTx: {
                id: 'test-tx-id',
                tx: 'signed-transaction',
              },
            },
          ],
        },
        txid: 'test-tx-id',
        tx: 'signed-transaction',
      });

      // Mock multisigType to return 'tss'
      const multisigTypeStub = sinon.stub(Wallet.prototype, 'multisigType').returns('tss');

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
      response.body.should.have.property('txRequest');
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction');

      walletGetNock.done();
      keychainGetNock.done();
      sinon.assert.calledOnce(sendManyStub);
      sinon.assert.calledOnce(multisigTypeStub);
    });
  });

  describe('SendMany TSS ECDSA:', () => {
    const coin = 'hteth';
    it('should send many transactions using ECDSA TSS signing', async () => {
      // Mock wallet get request for TSS wallet
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
        });

      // Mock keychain get request for TSS keychain
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'user-key-id',
          pub: 'xpub_user',
          commonKeychain: 'test-common-keychain',
          source: 'user',
          type: 'tss',
        });

      const sendManyStub = sinon.stub(Wallet.prototype, 'sendMany').resolves({
        txRequest: {
          txRequestId: 'test-tx-request-id',
          state: 'signed',
          apiVersion: 'full',
          pendingApprovalId: 'test-pending-approval-id',
          transactions: [
            {
              state: 'signed',
              unsignedTx: {
                derivationPath: 'm/0',
                signableHex: 'testMessage',
                serializedTxHex: 'testSerializedTxHex',
              },
              signatureShares: [],
              signedTx: {
                id: 'test-tx-id',
                tx: 'signed-transaction',
              },
            },
          ],
        },
        txid: 'test-tx-id',
        tx: 'signed-transaction',
      });

      // Mock multisigType to return 'tss'
      const multisigTypeStub = sinon.stub(Wallet.prototype, 'multisigType').returns('tss');

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
      response.body.should.have.property('txRequest');
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction');

      walletGetNock.done();
      keychainGetNock.done();
      sinon.assert.calledOnce(sendManyStub);
      sinon.assert.calledOnce(multisigTypeStub);
    });

    it('should be able to sign a fill nonce transaction', async () => {
      // Mock wallet get request for TSS wallet
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
        });

      // Mock keychain get request for TSS keychain
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'user-key-id',
          pub: 'xpub_user',
          commonKeychain: 'test-common-keychain',
          source: 'user',
          type: 'tss',
        });

      const sendManyStub = sinon.stub(Wallet.prototype, 'sendMany').resolves({
        txRequest: {
          txRequestId: 'test-tx-request-id',
          state: 'signed',
          apiVersion: 'full',
          pendingApprovalId: 'test-pending-approval-id',
          transactions: [
            {
              state: 'signed',
              unsignedTx: {
                derivationPath: 'm/0',
                signableHex: 'testMessage',
                serializedTxHex: 'testSerializedTxHex',
              },
              signatureShares: [],
              signedTx: {
                id: 'test-tx-id',
                tx: 'signed-transaction',
              },
            },
          ],
        },
        txid: 'test-tx-id',
        tx: 'signed-transaction',
      });

      // Mock multisigType to return 'tss'
      const multisigTypeStub = sinon.stub(Wallet.prototype, 'multisigType').returns('tss');

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/sendMany`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'fillNonce',
          nonce: '2',
          source: 'user',
          pubkey: 'xpub_user',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txRequest');
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction');

      walletGetNock.done();
      keychainGetNock.done();
      sinon.assert.calledOnce(sendManyStub);
      sinon.assert.calledOnce(multisigTypeStub);
    });

    it('should fail when backup key is used for ECDSA TSS signing', async () => {
      // Mock wallet get request for TSS wallet
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
        });

      // Mock keychain get request for backup TSS keychain
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/backup-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'backup-key-id',
          pub: 'xpub_backup',
          commonKeychain: 'test-common-keychain',
          source: 'backup',
          type: 'tss',
        });

      const sendManyStub = sinon.stub(Wallet.prototype, 'sendMany').resolves({
        txRequest: {
          txRequestId: 'test-tx-request-id',
          state: 'signed',
          apiVersion: 'full',
          pendingApprovalId: 'test-pending-approval-id',
        },
        txid: 'test-tx-id',
        tx: 'signed-transaction',
      });

      // Mock multisigType to return 'tss'
      const multisigTypeStub = sinon.stub(Wallet.prototype, 'multisigType').returns('tss');

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

      response.status.should.equal(400);
      response.body.details.should.equal('Backup MPC signing not supported for sendMany');

      walletGetNock.done();
      keychainGetNock.done();
      sinon.assert.notCalled(sendManyStub);
      sinon.assert.calledOnce(multisigTypeStub);
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

    response.status.should.equal(400);

    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when advanced wallet manager client is not configured', async () => {
    // Create a config without advanced wallet manager settings
    const invalidConfig: Partial<MasterExpressConfig> = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    try {
      expressApp(invalidConfig as MasterExpressConfig);
      assert(
        false,
        'Expected error to be thrown when advanced wallet manager client is not configured',
      );
    } catch (error) {
      (error as Error).message.should.equal(
        'advancedWalletManagerUrl and awmServerCaCert are required',
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
    const verifyStub = sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(false);

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

    response.status.should.equal(400);

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
      .stub(Tbtc.prototype, 'verifyTransaction')
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

    response.status.should.equal(400);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(prebuildStub);
    sinon.assert.calledOnce(verifyStub);
  });

  it('should handle BitGoApiResponseError correctly', async () => {
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

    const verifyStub = sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

    // Mock enclaved express sign request to return an error
    const signNock = nock(advancedWalletManagerUrl).post(`/api/${coin}/multisig/sign`).reply(500, {
      error: 'Internal Server Error',
      details: 'Custom API error details',
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
        pubkey: 'xpub_user',
      });

    // The response should be a 500 error with the error details
    response.status.should.equal(500);
    response.body.should.have.property('error');
    response.body.should.have.property('details');
    response.body.error.should.equal('Internal Server Error');
    response.body.details.should.deepEqual('Custom API error details');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(prebuildStub);
    sinon.assert.calledOnce(verifyStub);
    signNock.done();
  });
});
