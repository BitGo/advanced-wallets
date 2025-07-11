import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import {
  Environments,
  Wallet,
  TxRequest,
  PendingApprovals,
  State,
  Type,
  PendingApproval,
  BitGoBase,
  IBaseCoin,
} from '@bitgo/sdk-core';
import { BitGo } from 'bitgo';
import * as mpcv2 from '../../../api/master/handlers/ecdsaMPCv2';
import * as eddsa from '../../../api/master/handlers/eddsa';

describe('POST /api/:coin/wallet/:walletId/txrequest/:txRequestId/signAndSend', () => {
  let agent: request.SuperAgentTest;
  let bitgo: BitGoBase;
  let baseCoin: IBaseCoin;
  let wallet: Wallet;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const accessToken = 'test-token';
  const walletId = 'test-wallet-id';
  const txRequestId = 'test-tx-request-id';
  const coin = 'hteth'; // Use hteth for ECDSA testing

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    bitgo = new BitGo({ env: 'local' });
    baseCoin = bitgo.coin(coin);
    wallet = new Wallet(bitgo, baseCoin, walletId);

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

  after(() => {
    nock.enableNetConnect();
  });

  describe('ECDSA MPCv2 Sign and Send:', () => {
    it('should successfully sign and send ECDSA MPCv2 transaction with user key', async () => {
      // Mock wallet get request
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
          coin: 'hteth',
        });

      // Mock keychain get request for user key
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'user-key-id',
          pub: 'xpub_user',
          commonKeychain: 'common-keychain-123',
          source: 'user',
        });

      // Mock getTxRequest
      const txRequest: TxRequest = {
        txRequestId,
        apiVersion: 'full',
        enterpriseId: 'test-enterprise-id',
        transactions: [
          {
            unsignedTx: {
              derivationPath: 'm/0',
              signableHex: 'testMessage',
              serializedTxHex: 'testMessage',
            },
            state: 'pendingSignature',
            signatureShares: [],
          },
        ],
        state: 'pendingUserSignature',
        walletId,
        walletType: 'hot',
        version: 2,
        date: new Date().toISOString(),
        userId: 'test-user-id',
        intent: {},
        policiesChecked: true,
        unsignedTxs: [],
        latest: true,
      };

      const getTxRequestNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: 'test-tx-request-id', latest: true })
        .matchHeader('any', () => true)
        .reply(200, {
          txRequests: [txRequest],
        });

      // Replace the imported function with our stub
      const signAndSendStub = sinon.stub(mpcv2, 'signAndSendEcdsaMPCv2FromTxRequest').resolves({
        ...txRequest,
        state: 'signed',
        transactions: [
          {
            ...(txRequest.transactions || [])[0],
            signedTx: {
              id: 'test-tx-id',
              tx: 'signed-transaction-hex',
            },
          },
        ],
      });

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/txrequest/${txRequestId}/signAndSend`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          source: 'user',
          commonKeychain: 'common-keychain-123',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction-hex');

      walletGetNock.done();
      keychainGetNock.done();
      getTxRequestNock.done();
      sinon.assert.calledOnce(signAndSendStub);

      sinon.restore();
    });

    it('should handle pending approval response', async () => {
      // Mock wallet get request
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
          coin: 'hteth',
        });

      // Mock keychain get request
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'user-key-id',
          pub: 'xpub_user',
          commonKeychain: 'common-keychain-123',
          source: 'user',
        });

      // Mock getTxRequest
      const txRequest: TxRequest = {
        txRequestId,
        apiVersion: 'full',
        enterpriseId: 'test-enterprise-id',
        transactions: [],
        state: 'pendingUserSignature',
        walletId,
        walletType: 'hot',
        version: 2,
        date: new Date().toISOString(),
        userId: 'test-user-id',
        intent: {},
        policiesChecked: true,
        unsignedTxs: [],
        latest: true,
      };

      const getTxRequestNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: 'test-tx-request-id', latest: true })
        .matchHeader('any', () => true)
        .reply(200, {
          txRequests: [txRequest],
        });

      const signAndSendStub = sinon.stub(mpcv2, 'signAndSendEcdsaMPCv2FromTxRequest').resolves({
        ...txRequest,
        state: 'pendingApproval',
        pendingApprovalId: 'pending-approval-id',
      });

      const pendingApprovalData = {
        id: 'pending-approval-id',
        wallet: 'test-wallet-id',
        state: 'pending' as State,
        creator: 'test-user-id',
        info: {
          type: 'transactionRequestFull' as Type,
          transactionRequestFull: {
            ...txRequest,
          },
        },
      };

      const mockPendingApproval = new PendingApproval(bitgo, baseCoin, pendingApprovalData, wallet);

      sinon.stub(PendingApprovals.prototype, 'get').resolves(mockPendingApproval);

      const response = await agent
        .post(`/api/${coin}/wallet/${walletId}/txrequest/${txRequestId}/signAndSend`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          source: 'user',
          commonKeychain: 'common-keychain-123',
        });

      response.status.should.equal(200);
      response.body.should.have.property('pendingApproval');
      response.body.should.have.property('txRequest');
      response.body.pendingApproval.should.have.property('id', 'pending-approval-id');

      walletGetNock.done();
      keychainGetNock.done();
      getTxRequestNock.done();
      sinon.assert.calledOnce(signAndSendStub);

      sinon.restore();
    });
  });

  describe('EdDSA Sign and Send:', () => {
    const eddsaCoin = 'tsol'; // Use tsol for EdDSA testing

    it('should successfully sign and send EdDSA transaction', async () => {
      // Mock wallet get request
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${eddsaCoin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'cold',
          subType: 'onPrem',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
          coin: 'tsol',
        });

      // Mock keychain get request
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${eddsaCoin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'user-key-id',
          pub: 'xpub_user',
          commonKeychain: 'common-keychain-123',
          source: 'user',
        });

      // Mock getTxRequest
      const txRequest: TxRequest = {
        txRequestId,
        apiVersion: 'full',
        enterpriseId: 'test-enterprise-id',
        transactions: [
          {
            unsignedTx: {
              derivationPath: 'm/0',
              signableHex: 'testMessage',
              serializedTxHex: 'testMessage',
            },
            state: 'pendingSignature',
            signatureShares: [],
          },
        ],
        state: 'pendingUserSignature',
        walletId,
        walletType: 'hot',
        version: 2,
        date: new Date().toISOString(),
        userId: 'test-user-id',
        intent: {},
        policiesChecked: true,
        unsignedTxs: [],
        latest: true,
      };

      const getTxRequestNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: 'test-tx-request-id', latest: true })
        .matchHeader('any', () => true)
        .reply(200, {
          txRequests: [txRequest],
        });

      const signAndSendStub = sinon.stub(eddsa, 'handleEddsaSigning').resolves({
        ...txRequest,
        state: 'signed',
        transactions: [
          {
            ...(txRequest.transactions || [])[0],
            signedTx: {
              id: 'test-tx-id',
              tx: 'signed-transaction-hex',
            },
          },
        ],
      });

      const response = await agent
        .post(`/api/${eddsaCoin}/wallet/${walletId}/txrequest/${txRequestId}/signAndSend`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          source: 'user',
          commonKeychain: 'common-keychain-123',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction-hex');

      walletGetNock.done();
      keychainGetNock.done();
      getTxRequestNock.done();
      sinon.assert.calledOnce(signAndSendStub);

      sinon.restore();
    });
  });
});
