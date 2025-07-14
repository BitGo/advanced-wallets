import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo/sdk-core';
import { Hteth } from '@bitgo/sdk-coin-eth';
import * as transactionRequests from '../../../api/master/handlers/transactionRequests';
import * as handlerUtils from '../../../api/master/handlerUtils';

describe('POST /api/:coin/wallet/:walletId/consolidateunspents', () => {
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
      port: 0,
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

  // Helper functions to reduce duplication
  const mockWalletGet = (multisigType: 'onchain' | 'tss') => {
    return nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType,
      });
  };

  const mockKeychainGet = (commonKeychain?: string) => {
    return nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
        ...(commonKeychain && { commonKeychain }),
      });
  };

  const mockTxRequest = (txRequestId: string) => {
    return nock(bitgoApiUrl)
      .get(`/api/v2/wallet/${walletId}/txrequests`)
      .query({ txRequestIds: txRequestId, latest: 'true' })
      .matchHeader('any', () => true)
      .reply(200, {
        txRequests: [
          {
            txRequestId,
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
  };

  const createMultisigBuild = (index: number) => ({
    walletId,
    txHex: `unsigned-tx-hex-${index}`,
    txInfo: { unspents: [] },
    feeInfo: { fee: 1000 + index * 500 },
  });

  const createMpcBuild = (index: number) => ({
    walletId,
    txHex: `unsigned-mpc-tx-hex-${index}`,
    txInfo: { unspents: [] },
    feeInfo: { fee: 2000 + index * 500 },
    txRequestId: `mpc-tx-request-${index}`,
  });

  describe('Multisig Wallets (onchain)', () => {
    it('should consolidate multisig wallet addresses successfully', async () => {
      // Mock wallet and keychain requests
      const walletGetNock = mockWalletGet('onchain');
      const keychainGetNock = mockKeychainGet();

      // Mock buildAccountConsolidations
      const buildConsolidationsStub = sinon
        .stub(Wallet.prototype, 'buildAccountConsolidations')
        .resolves([createMultisigBuild(1), createMultisigBuild(2)]);

      // Mock sendAccountConsolidation for multisig wallets
      const sendAccountConsolidationStub = sinon
        .stub(Wallet.prototype, 'sendAccountConsolidation')
        .resolves({
          txid: 'consolidation-tx-1',
          status: 'signed',
        });

      // Mock makeCustomSigningFunction
      const makeCustomSigningFunctionStub = sinon
        .stub(handlerUtils, 'makeCustomSigningFunction')
        .returns(() => Promise.resolve({ txHex: 'signed-tx-hex' }));

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
      response.body.success.should.have.length(2); // Two successful builds
      response.body.should.have.property('failure');
      response.body.failure.should.have.length(0);

      walletGetNock.done();
      keychainGetNock.done();
      sinon.assert.calledOnce(buildConsolidationsStub);
      sinon.assert.calledTwice(sendAccountConsolidationStub); // Called for each build
      sinon.assert.calledTwice(makeCustomSigningFunctionStub);
    });

    it('should handle partial multisig consolidation failures', async () => {
      // Mock wallet and keychain requests
      const walletGetNock = mockWalletGet('onchain');
      const keychainGetNock = mockKeychainGet();

      // Mock buildAccountConsolidations with multiple builds
      const buildConsolidationsStub = sinon
        .stub(Wallet.prototype, 'buildAccountConsolidations')
        .resolves([createMultisigBuild(1), createMultisigBuild(2)]);

      // Mock sendAccountConsolidation - first succeeds, second fails
      const sendAccountConsolidationStub = sinon.stub(Wallet.prototype, 'sendAccountConsolidation');
      sendAccountConsolidationStub.onFirstCall().resolves({
        txid: 'consolidation-tx-1',
        status: 'signed',
      });
      sendAccountConsolidationStub.onSecondCall().rejects(new Error('Insufficient funds'));

      // Mock makeCustomSigningFunction
      const makeCustomSigningFunctionStub = sinon
        .stub(handlerUtils, 'makeCustomSigningFunction')
        .returns(() => Promise.resolve({ txHex: 'signed-tx-hex' }));

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/consolidate`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          source: 'user',
          pubkey: 'xpub_user',
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
    });

    it('should throw error when all multisig consolidations fail', async () => {
      // Mock wallet and keychain requests
      const walletGetNock = mockWalletGet('onchain');
      const keychainGetNock = mockKeychainGet();

      // Mock buildAccountConsolidations with multiple builds
      const buildConsolidationsStub = sinon
        .stub(Wallet.prototype, 'buildAccountConsolidations')
        .resolves([createMultisigBuild(1), createMultisigBuild(2)]);

      // Mock sendAccountConsolidation to always fail
      const sendAccountConsolidationStub = sinon
        .stub(Wallet.prototype, 'sendAccountConsolidation')
        .rejects(new Error('All consolidations failed'));

      // Mock makeCustomSigningFunction
      const makeCustomSigningFunctionStub = sinon
        .stub(handlerUtils, 'makeCustomSigningFunction')
        .returns(() => Promise.resolve({ txHex: 'signed-tx-hex' }));

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
      sinon.assert.calledOnce(buildConsolidationsStub);
      sinon.assert.calledTwice(sendAccountConsolidationStub);
      sinon.assert.calledTwice(makeCustomSigningFunctionStub);
    });
  });

  describe('MPC Wallets (tss)', () => {
    it('should consolidate MPC wallet using signAndSendTxRequests', async () => {
      // Mock wallet and keychain requests for MPC wallet
      const walletGetNock = mockWalletGet('tss');
      const keychainGetNock = mockKeychainGet('user-common-key');

      // Mock buildAccountConsolidations for MPC
      const buildConsolidationsStub = sinon
        .stub(Wallet.prototype, 'buildAccountConsolidations')
        .resolves([createMpcBuild(1)]);

      // Mock the HTTP request for getTxRequest
      const getTxRequestNock = mockTxRequest('mpc-tx-request-1');

      // Mock signAndSendTxRequests for MPC wallets
      const signAndSendTxRequestsStub = sinon
        .stub(transactionRequests, 'signAndSendTxRequests')
        .resolves({
          txid: 'mpc-consolidation-tx-1',
          status: 'signed',
          state: 'signed',
        });

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/consolidate`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          source: 'user',
          commonKeychain: 'user-common-key',
          consolidateAddresses: ['0x1234567890abcdef'],
        });

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

      // Verify MPC-specific parameters
      sinon.assert.calledWith(buildConsolidationsStub, sinon.match.hasNested('apiVersion', 'full'));
    });

    it('should handle partial MPC consolidation failures', async () => {
      // Mock wallet and keychain requests for MPC wallet
      const walletGetNock = mockWalletGet('tss');
      const keychainGetNock = mockKeychainGet('user-common-key');

      // Mock buildAccountConsolidations with multiple builds for MPC
      const buildConsolidationsStub = sinon
        .stub(Wallet.prototype, 'buildAccountConsolidations')
        .resolves([createMpcBuild(1), createMpcBuild(2)]);

      // Mock the HTTP requests for getTxRequest (both tx requests)
      const getTxRequestNock1 = mockTxRequest('mpc-tx-request-1');
      const getTxRequestNock2 = mockTxRequest('mpc-tx-request-2');

      // Mock signAndSendTxRequests - first succeeds, second fails
      const signAndSendTxRequestsStub = sinon.stub(transactionRequests, 'signAndSendTxRequests');
      signAndSendTxRequestsStub.onFirstCall().resolves({
        txid: 'mpc-consolidation-tx-1',
        status: 'signed',
        state: 'signed',
      });
      signAndSendTxRequestsStub.onSecondCall().rejects(new Error('MPC signing failed'));

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/consolidate`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          source: 'user',
          commonKeychain: 'user-common-key',
          consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
        });

      response.status.should.equal(500);
      response.body.should.have.property('error', 'Internal Server Error');
      response.body.should.have
        .property('details')
        .which.match(/Consolidations failed: 1 and succeeded: 1/);

      walletGetNock.done();
      keychainGetNock.done();
      getTxRequestNock1.done();
      getTxRequestNock2.done();
      sinon.assert.calledOnce(buildConsolidationsStub);
      sinon.assert.calledTwice(signAndSendTxRequestsStub);
    });

    it('should throw error when all MPC consolidations fail', async () => {
      // Mock wallet and keychain requests for MPC wallet
      const walletGetNock = mockWalletGet('tss');
      const keychainGetNock = mockKeychainGet('user-common-key');

      // Mock buildAccountConsolidations with multiple builds for MPC
      const buildConsolidationsStub = sinon
        .stub(Wallet.prototype, 'buildAccountConsolidations')
        .resolves([createMpcBuild(1), createMpcBuild(2)]);

      // Mock the HTTP requests for getTxRequest (both tx requests)
      const getTxRequestNock1 = mockTxRequest('mpc-tx-request-1');
      const getTxRequestNock2 = mockTxRequest('mpc-tx-request-2');

      // Mock signAndSendTxRequests to always fail for MPC
      const signAndSendTxRequestsStub = sinon
        .stub(transactionRequests, 'signAndSendTxRequests')
        .rejects(new Error('All MPC consolidations failed'));

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/consolidate`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          source: 'user',
          commonKeychain: 'user-common-key',
          consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
        });

      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.should.have.property('details').which.match(/All consolidations failed/);

      walletGetNock.done();
      keychainGetNock.done();
      getTxRequestNock1.done();
      getTxRequestNock2.done();
      sinon.assert.calledOnce(buildConsolidationsStub);
      sinon.assert.calledTwice(signAndSendTxRequestsStub);
    });
  });

  describe('Common Error Cases', () => {
    it('should throw error when coin does not support account consolidations', async () => {
      // Mock wallet and keychain requests
      const walletGetNock = mockWalletGet('onchain');
      const keychainGetNock = mockKeychainGet();

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
      // Mock wallet and keychain requests
      const walletGetNock = mockWalletGet('onchain');
      const keychainGetNock = mockKeychainGet();

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
});
