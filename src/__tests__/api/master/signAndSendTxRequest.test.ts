import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments } from '@bitgo-beta/sdk-core';
import {
  BitGoAPITestHarness,
  buildEcdsaMpcv2TxRequest,
  DEFAULT_ECDSA_MPCV2_TX_REQUEST_ID,
  DEFAULT_ECDSA_MPCV2_WALLET_ID,
  nockEcdsaMpcv2SigningFlow,
} from './testUtils';

const walletId = DEFAULT_ECDSA_MPCV2_WALLET_ID;
const txRequestId = DEFAULT_ECDSA_MPCV2_TX_REQUEST_ID;

describe('POST /api/v1/:coin/advancedwallet/:walletId/txrequest/:txRequestId/signAndSend', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const accessToken = 'test-token';
  const coin = 'hteth'; // Use hteth for ECDSA testing

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
    BitGoAPITestHarness.clearConstantsCache();
  });

  after(() => {
    nock.enableNetConnect();
  });

  function nockWalletAndSigningKeychain(coinName: string) {
    nock(bitgoApiUrl)
      .get(`/api/v2/${coinName}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'advanced',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType: 'tss',
        coin: coinName,
      });

    nock(bitgoApiUrl)
      .get(`/api/v2/${coinName}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
        commonKeychain: 'common-keychain-123',
        source: 'user',
      });
  }

  describe('ECDSA MPCv2 Sign and Send:', () => {
    it('should successfully sign and send ECDSA MPCv2 transaction with user key', async () => {
      nockWalletAndSigningKeychain(coin);

      const getTxRequestNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: txRequestId, latest: true })
        .matchHeader('any', () => true)
        .reply(200, { txRequests: [buildEcdsaMpcv2TxRequest('pendingUserSignature')] });

      const signedTxRequest = buildEcdsaMpcv2TxRequest('signed', {
        extra: {
          transactions: [
            {
              unsignedTx: { derivationPath: 'm/0', signableHex: 'testMessage' },
              state: 'signed',
              signedTx: { id: 'test-tx-id', tx: 'signed-transaction-hex' },
            },
          ],
        },
      });
      const nocks = nockEcdsaMpcv2SigningFlow({
        coin,
        bitgoApiUrl,
        advancedWalletManagerUrl,
        sendResponse: signedTxRequest,
        includeBitgoKeychainNock: true,
      });

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/txrequest/${txRequestId}/signAndSend`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'user', commonKeychain: 'common-keychain-123' });

      response.status.should.equal(200);
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction-hex');

      getTxRequestNock.done();
      nocks.round1SignNock.done();
      nocks.round2SignNock.done();
      nocks.round3SignNock.done();
      nocks.sendTxNock.done();
      nocks.awmRound1Nock.done();
      nocks.awmRound2Nock.done();
      nocks.awmRound3Nock.done();
    });

    it('should handle pending approval response', async () => {
      nockWalletAndSigningKeychain(coin);

      const getTxRequestNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: txRequestId, latest: true })
        .matchHeader('any', () => true)
        .reply(200, { txRequests: [buildEcdsaMpcv2TxRequest('pendingUserSignature')] });

      const pendingApprovalTxRequest = buildEcdsaMpcv2TxRequest('pendingApproval', {
        extra: { pendingApprovalId: 'pending-approval-id' },
      });
      const nocks = nockEcdsaMpcv2SigningFlow({
        coin,
        bitgoApiUrl,
        advancedWalletManagerUrl,
        sendResponse: pendingApprovalTxRequest,
        includeBitgoKeychainNock: true,
      });

      const pendingApprovalNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/pendingapprovals/pending-approval-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'pending-approval-id',
          wallet: walletId,
          state: 'pending',
          creator: 'test-user-id',
          info: { type: 'transactionRequestFull' },
        });

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/txrequest/${txRequestId}/signAndSend`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'user', commonKeychain: 'common-keychain-123' });

      response.status.should.equal(200);
      response.body.should.have.property('pendingApproval');
      response.body.should.have.property('txRequest');
      response.body.pendingApproval.should.have.property('id', 'pending-approval-id');

      getTxRequestNock.done();
      nocks.sendTxNock.done();
      pendingApprovalNock.done();
    });
  });

  describe('EdDSA Sign and Send:', () => {
    const eddsaCoin = 'tsol'; // Use tsol for EdDSA testing

    it('should successfully sign and send EdDSA transaction', async () => {
      const pending = {
        txRequestId,
        apiVersion: 'full',
        enterpriseId: 'test-enterprise-id',
        transactions: [
          {
            state: 'pendingSignature',
            unsignedTx: {
              derivationPath: 'm/0',
              signableHex: 'testMessage',
              serializedTxHex: 'testSerializedTxHex',
            },
            signatureShares: [
              { share: 'bitgo-to-user-r-share', from: 'bitgo', to: 'user', type: 'r' },
              { share: 'user-to-bitgo-r-share', from: 'user', to: 'bitgo', type: 'r' },
            ],
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
      const signed = {
        ...pending,
        state: 'signed',
        transactions: [
          {
            ...pending.transactions[0],
            state: 'signed',
            signedTx: { id: 'test-tx-id', tx: 'signed-transaction-hex' },
          },
        ],
      };

      nockWalletAndSigningKeychain(eddsaCoin);

      // pickBitgoPubGpgKeyForSigning resolves the BitGo GPG key from the keychain hsmType
      nock(bitgoApiUrl)
        .get(`/api/v2/${eddsaCoin}/key/bitgo-key-id`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: 'bitgo-key-id',
          pub: 'xpub_bitgo',
          commonKeychain: 'common-keychain-123',
          source: 'bitgo',
          type: 'tss',
          hsmType: 'institutional',
        });

      // Three GET /txrequests calls
      const handlerGetTxRequestNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: txRequestId, latest: true })
        .matchHeader('any', () => true)
        .reply(200, { txRequests: [pending] });

      const exchangeCommitmentsNock = nock(bitgoApiUrl)
        .post(`/api/v2/wallet/${walletId}/txrequests/${txRequestId}/transactions/0/commit`)
        .matchHeader('any', () => true)
        .reply(200, { commitmentShare: { share: 'bitgo-commitment-share' } });

      const offerRShareNock = nock(bitgoApiUrl)
        .post(`/api/v2/wallet/${walletId}/txrequests/${txRequestId}/transactions/0/signatureshares`)
        .matchHeader('any', () => true)
        .reply(200, { share: 'user-to-bitgo-r-share', from: 'bitgo', to: 'user' });

      const getBitgoRShareNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: txRequestId, latest: true })
        .matchHeader('any', () => true)
        .reply(200, { txRequests: [pending] });

      const sendGShareNock = nock(bitgoApiUrl)
        .post(`/api/v2/wallet/${walletId}/txrequests/${txRequestId}/transactions/0/signatureshares`)
        .matchHeader('any', () => true)
        .reply(200, { share: 'user-to-bitgo-g-share', from: 'bitgo', to: 'user' });

      const finalGetTxRequestNock = nock(bitgoApiUrl)
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query({ txRequestIds: txRequestId, latest: true })
        .matchHeader('any', () => true)
        .reply(200, { txRequests: [signed] });

      const signMpcCommitmentNockAwm = nock(advancedWalletManagerUrl)
        .post(`/api/${eddsaCoin}/mpc/sign/commitment`)
        .reply(200, {
          userToBitgoCommitment: { share: 'user-commitment-share' },
          encryptedSignerShare: { share: 'encrypted-signer-share' },
          encryptedUserToBitgoRShare: { share: 'encrypted-user-to-bitgo-r-share' },
          encryptedDataKey: 'test-encrypted-data-key',
        });

      const signMpcRShareNockAwm = nock(advancedWalletManagerUrl)
        .post(`/api/${eddsaCoin}/mpc/sign/r`)
        .reply(200, {
          rShare: {
            rShares: [
              { r: 'r-share', R: 'R-share' },
              { r: 'r-share-2', R: 'R-share-2' },
              { r: 'r-share-3', R: 'R-share-3' },
              { r: 'r-share-4', R: 'R-share-4', i: 3, j: 1 },
            ],
          },
        });

      const signMpcGShareNockAwm = nock(advancedWalletManagerUrl)
        .post(`/api/${eddsaCoin}/mpc/sign/g`)
        .reply(200, { gShare: { r: 'r', gamma: 'gamma', i: 1, j: 3, n: 4 } });

      const response = await agent
        .post(
          `/api/v1/${eddsaCoin}/advancedwallet/${walletId}/txrequest/${txRequestId}/signAndSend`,
        )
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'user', commonKeychain: 'common-keychain-123' });

      response.status.should.equal(200);
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction-hex');

      handlerGetTxRequestNock.done();
      exchangeCommitmentsNock.done();
      offerRShareNock.done();
      getBitgoRShareNock.done();
      sendGShareNock.done();
      finalGetTxRequestNock.done();
      signMpcCommitmentNockAwm.done();
      signMpcRShareNockAwm.done();
      signMpcGShareNockAwm.done();
    });
  });
});
