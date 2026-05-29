import 'should';
import sinon from 'sinon';

import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import {
  Environments,
  openpgpUtils,
  SignatureShareRecord,
  SignatureShareType,
} from '@bitgo-beta/sdk-core';
import * as utxolib from '@bitgo-beta/utxo-lib';
import { Tbtc } from '@bitgo-beta/sdk-coin-btc';
import { Tsol } from '@bitgo-beta/sdk-coin-sol';
import assert from 'assert';
import { BitGoAPITestHarness } from './testUtils';

const testWalletId = 'test-wallet-id';
const testBitgoApiUrl = Environments.test.uri;
const tssTxRequestId = 'test-tx-request-id';

const TBTC_PREBUILD_PSBT_HEX = utxolib.bitgo
  .createPsbtForNetwork({ network: utxolib.networks.testnet })
  .toHex();

function buildPendingEdDsaTxRequest(walletIdParam: string) {
  return {
    txRequestId: tssTxRequestId,
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
          { share: 'bitgo-to-user-r-share', from: 'bitgo', to: 'user' },
          { share: 'user-to-bitgo-r-share', from: 'user', to: 'bitgo' },
        ],
      },
    ],
    state: 'pendingUserSignature',
    walletId: walletIdParam,
    walletType: 'hot',
    version: 2,
    date: new Date().toISOString(),
    userId: 'test-user-id',
    intent: {},
    policiesChecked: true,
    unsignedTxs: [],
    latest: true,
  };
}

function buildSignedEdDsaTxRequest(walletIdParam: string) {
  const pending = buildPendingEdDsaTxRequest(walletIdParam);
  return {
    ...pending,
    state: 'signed',
    transactions: [
      {
        ...pending.transactions[0],
        state: 'signed',
        signedTx: { id: 'test-tx-id', tx: 'signed-transaction' },
      },
    ],
  };
}

function nockTssWalletKeychains(coinName: string) {
  nock(testBitgoApiUrl)
    .get(`/api/v2/${coinName}/key/user-key-id`)
    .matchHeader('any', () => true)
    .times(10)
    .reply(200, {
      id: 'user-key-id',
      pub: 'xpub_user',
      commonKeychain: 'test-common-keychain',
      source: 'user',
      type: 'tss',
    });
  nock(testBitgoApiUrl)
    .get(`/api/v2/${coinName}/key/backup-key-id`)
    .matchHeader('any', () => true)
    .times(10)
    .reply(200, {
      id: 'backup-key-id',
      pub: 'xpub_backup',
      commonKeychain: 'test-common-keychain',
      source: 'backup',
      type: 'tss',
    });
  nock(testBitgoApiUrl)
    .get(`/api/v2/${coinName}/key/bitgo-key-id`)
    .matchHeader('any', () => true)
    .times(10)
    .reply(200, {
      id: 'bitgo-key-id',
      pub: 'xpub_bitgo',
      commonKeychain: 'test-common-keychain',
      source: 'bitgo',
      type: 'tss',
      hsmType: 'institutional',
    });
}

function buildPendingEcdsaMPCv2TxRequest(walletIdParam: string) {
  return {
    txRequestId: tssTxRequestId,
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
        signatureShares: [] as SignatureShareRecord[],
      },
    ],
    state: 'pendingUserSignature',
    walletId: walletIdParam,
    walletType: 'hot',
    version: 2,
    date: new Date().toISOString(),
    userId: 'test-user-id',
    intent: {},
    policiesChecked: true,
    unsignedTxs: [],
    latest: true,
  };
}

function buildSignedEcdsaMPCv2TxRequest(walletIdParam: string) {
  const pending = buildPendingEcdsaMPCv2TxRequest(walletIdParam);
  return {
    ...pending,
    state: 'signed',
    transactions: [
      {
        ...pending.transactions[0],
        state: 'signed',
        signedTx: { id: 'test-tx-id', tx: 'signed-transaction' },
      },
    ],
  };
}

function nockEcdsaMPCv2SigningFlow(
  coin: string,
  walletIdParam: string,
  bitgoApiUrlParam: string,
  advancedWalletManagerUrlParam: string,
) {
  const round1SignatureShare: SignatureShareRecord = {
    from: SignatureShareType.USER,
    to: SignatureShareType.BITGO,
    share: JSON.stringify({
      type: 'round1Input',
      data: { msg1: { from: 1, message: 'round1-message' } },
    }),
  };
  const round2SignatureShare: SignatureShareRecord = {
    from: SignatureShareType.USER,
    to: SignatureShareType.BITGO,
    share: JSON.stringify({
      type: 'round2Input',
      data: {
        msg2: { from: 1, to: 3, encryptedMessage: 'round2-message', signature: 'round2-signature' },
        msg3: { from: 1, to: 3, encryptedMessage: 'round3-message', signature: 'round3-signature' },
      },
    }),
  };
  const round3SignatureShare: SignatureShareRecord = {
    from: SignatureShareType.USER,
    to: SignatureShareType.BITGO,
    share: JSON.stringify({
      type: 'round3Input',
      data: {
        msg4: {
          from: 1,
          message: 'round4-message',
          signature: 'round4-signature',
          signatureR: 'round4-signature-r',
        },
      },
    }),
  };

  const pendingTxRequest = buildPendingEcdsaMPCv2TxRequest(walletIdParam);
  const signedTxRequest = buildSignedEcdsaMPCv2TxRequest(walletIdParam);

  // The SDK fetches the user keychain in handleSendMany (validation) and again inside
  // prebuildAndSignTransaction → getKeysForSigning, so use persist().
  nock(bitgoApiUrlParam)
    .persist()
    .get(`/api/v2/${coin}/key/user-key-id`)
    .matchHeader('any', () => true)
    .reply(200, {
      id: 'user-key-id',
      pub: 'xpub_user',
      commonKeychain: 'test-common-keychain',
      source: 'user',
      type: 'tss',
    });

  // pickBitgoPubGpgKeyForSigning fetches the BitGo keychain to resolve the GPG key via
  // hsmType → getBitgoMpcGpgPubKey. env:'test' requires this path (no constants fallback).
  nock(bitgoApiUrlParam)
    .get(`/api/v2/${coin}/key/bitgo-key-id`)
    .matchHeader('any', () => true)
    .reply(200, {
      id: 'bitgo-key-id',
      pub: 'xpub_bitgo',
      commonKeychain: 'test-common-keychain',
      source: 'bitgo',
      type: 'tss',
      hsmType: 'institutional',
    });

  const createTxRequestNock = nock(bitgoApiUrlParam)
    .post(`/api/v2/wallet/${walletIdParam}/txrequests`)
    .matchHeader('any', () => true)
    .reply(200, pendingTxRequest);

  // getTxRequest is called three times: in prebuildAndSignTransaction, in
  // signEcdsaMPCv2TssUsingExternalSigner, and in sendManyTxRequests.
  nock(bitgoApiUrlParam)
    .persist()
    .get(`/api/v2/wallet/${walletIdParam}/txrequests`)
    .query(true)
    .matchHeader('any', () => true)
    .reply(200, { txRequests: [signedTxRequest] });

  const round1SignNock = nock(bitgoApiUrlParam)
    .post(`/api/v2/wallet/${walletIdParam}/txrequests/${tssTxRequestId}/transactions/0/sign`)
    .matchHeader('any', () => true)
    .reply(200, {
      ...pendingTxRequest,
      transactions: [
        { ...pendingTxRequest.transactions[0], signatureShares: [round1SignatureShare] },
      ],
    });

  const round2SignNock = nock(bitgoApiUrlParam)
    .post(`/api/v2/wallet/${walletIdParam}/txrequests/${tssTxRequestId}/transactions/0/sign`)
    .matchHeader('any', () => true)
    .reply(200, {
      ...pendingTxRequest,
      transactions: [
        {
          ...pendingTxRequest.transactions[0],
          signatureShares: [round1SignatureShare, round2SignatureShare],
        },
      ],
    });

  const round3SignNock = nock(bitgoApiUrlParam)
    .post(`/api/v2/wallet/${walletIdParam}/txrequests/${tssTxRequestId}/transactions/0/sign`)
    .matchHeader('any', () => true)
    .reply(200, {
      ...pendingTxRequest,
      transactions: [
        {
          ...pendingTxRequest.transactions[0],
          signatureShares: [round1SignatureShare, round2SignatureShare, round3SignatureShare],
        },
      ],
    });

  const sendTxNock = nock(bitgoApiUrlParam)
    .post(`/api/v2/wallet/${walletIdParam}/txrequests/${tssTxRequestId}/transactions/0/send`)
    .matchHeader('any', () => true)
    .reply(200, pendingTxRequest);

  const transferNock = nock(bitgoApiUrlParam)
    .post(`/api/v2/wallet/${walletIdParam}/txrequests/${tssTxRequestId}/transfers`)
    .matchHeader('any', () => true)
    .reply(200, { state: 'signed' });

  const awmRound1Nock = nock(advancedWalletManagerUrlParam)
    .post(`/api/${coin}/mpc/sign/mpcv2round1`)
    .reply(200, {
      signatureShareRound1: round1SignatureShare,
      userGpgPubKey: 'user-gpg-pub-key',
      encryptedRound1Session: 'encrypted-round1-session',
      encryptedUserGpgPrvKey: 'encrypted-user-gpg-prv-key',
      encryptedDataKey: 'test-encrypted-data-key',
    });

  const awmRound2Nock = nock(advancedWalletManagerUrlParam)
    .post(`/api/${coin}/mpc/sign/mpcv2round2`)
    .reply(200, {
      signatureShareRound2: round2SignatureShare,
      encryptedRound2Session: 'encrypted-round2-session',
    });

  const awmRound3Nock = nock(advancedWalletManagerUrlParam)
    .post(`/api/${coin}/mpc/sign/mpcv2round3`)
    .reply(200, {
      signatureShareRound3: round3SignatureShare,
    });

  return {
    createTxRequestNock,
    round1SignNock,
    round2SignNock,
    round3SignNock,
    sendTxNock,
    transferNock,
    awmRound1Nock,
    awmRound2Nock,
    awmRound3Nock,
  };
}

describe('POST /api/v1/:coin/advancedwallet/:walletId/sendMany', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const accessToken = 'test-token';
  const walletId = testWalletId;
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
    BitGoAPITestHarness.clearConstantsCache();
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
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'onchain',
        });

      // Mock keychain get requests — user-key-id is fetched twice (signing key + walletPubs for UTXO signing)
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .times(2)
        .reply(200, { id: 'user-key-id', pub: 'xpub_user' });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/backup-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'backup-key-id', pub: 'xpub_backup' });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/bitgo-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo' });

      const prebuildBuildNock = nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
        .reply(200, {
          txHex: TBTC_PREBUILD_PSBT_HEX,
          txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
        });
      nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

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
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
      prebuildBuildNock.done();
      sinon.assert.calledOnce(verifyStub);
      keychainGetNock.done();
      signNock.done();
      submitNock.done();
    });

    it('should send walletPubs (all 3 xpubs) to AWM for UTXO signing', async () => {
      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'onchain',
        });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .times(2)
        .reply(200, { id: 'user-key-id', pub: 'xpub_user' });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/backup-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'backup-key-id', pub: 'xpub_backup' });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/bitgo-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo' });

      nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
        .reply(200, {
          txHex: TBTC_PREBUILD_PSBT_HEX,
          txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
        });
      nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

      sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

      let capturedSignBody: any;
      const signNock = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/multisig/sign`, (body) => {
          capturedSignBody = body;
          return true;
        })
        .reply(200, {
          halfSigned: { txHex: 'signed-tx-hex', txInfo: {} },
          walletId,
          source: 'user',
          pub: 'xpub_user',
        });

      nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
        .matchHeader('any', () => true)
        .reply(200, { txid: 'test-tx-id', status: 'signed' });

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          recipients: [{ address: 'tb1qtest1', amount: '100000' }],
          source: 'user',
          pubkey: 'xpub_user',
        });

      response.status.should.equal(200);
      signNock.done();
      capturedSignBody.should.have.property('walletPubs');
      capturedSignBody.walletPubs.should.deepEqual(['xpub_user', 'xpub_backup', 'xpub_bitgo']);
    });

    it('should omit walletPubs from AWM request when any keychain is missing a pub', async () => {
      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'onchain',
        });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .times(2)
        .reply(200, { id: 'user-key-id', pub: 'xpub_user' });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/backup-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'backup-key-id' }); // no pub

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/bitgo-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo' });

      nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
        .reply(200, {
          txHex: TBTC_PREBUILD_PSBT_HEX,
          txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
        });
      nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

      sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

      let capturedSignBody: any;
      const signNock = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/multisig/sign`, (body) => {
          capturedSignBody = body;
          return true;
        })
        .reply(200, {
          halfSigned: { txHex: 'signed-tx-hex', txInfo: {} },
          walletId,
          source: 'user',
          pub: 'xpub_user',
        });

      nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
        .matchHeader('any', () => true)
        .reply(200, { txid: 'test-tx-id', status: 'signed' });

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          recipients: [{ address: 'tb1qtest1', amount: '100000' }],
          source: 'user',
          pubkey: 'xpub_user',
        });

      response.status.should.equal(200);
      signNock.done();
      capturedSignBody.should.not.have.property('walletPubs');
    });

    it('should handle backup key signing', async () => {
      // Mock wallet get request
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        });

      // Mock keychain get requests — backup-key-id fetched twice (signing key + walletPubs)
      const keychainGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/backup-key-id`)
        .matchHeader('any', () => true)
        .times(2)
        .reply(200, { id: 'backup-key-id', pub: 'xpub_backup' });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/user-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'user-key-id', pub: 'xpub_user' });

      nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/key/bitgo-key-id`)
        .matchHeader('any', () => true)
        .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo' });

      const prebuildBuildNock = nock(bitgoApiUrl)
        .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
        .reply(200, {
          txHex: TBTC_PREBUILD_PSBT_HEX,
          txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
        });
      nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

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
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
      prebuildBuildNock.done();
      sinon.assert.calledOnce(verifyStub);
      keychainGetNock.done();
      signNock.done();
      submitNock.done();
    });
  });

  describe('SendMany TSS EDDSA:', () => {
    const coin = 'tsol';
    it('should send many transactions using EDDSA TSS signing', async () => {
      const bitgoGpgKey = await openpgpUtils.generateGPGKeyPair('ed25519');
      const pendingTxRequest = buildPendingEdDsaTxRequest(walletId);
      const signedTxRequest = buildSignedEdDsaTxRequest(walletId);

      nock(bitgoApiUrl)
        .persist()
        .get('/api/v1/client/constants')
        .reply(200, { constants: { mpc: { bitgoPublicKey: bitgoGpgKey.publicKey } } });

      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
        });

      nockTssWalletKeychains(coin);
      sinon.stub(Tsol.prototype, 'verifyTransaction').resolves(true);

      let capturedTxRequestBody: Record<string, unknown> | undefined;
      const createTxRequestNock = nock(bitgoApiUrl)
        .post(`/api/v2/wallet/${walletId}/txrequests`, (body) => {
          capturedTxRequestBody = body;
          return true;
        })
        .matchHeader('any', () => true)
        .reply(200, pendingTxRequest);

      const deleteSigSharesNock = nock(bitgoApiUrl)
        .delete(`/api/v2/wallet/${walletId}/txrequests/${tssTxRequestId}/signatureshares`)
        .matchHeader('any', () => true)
        .reply(200, []);

      const exchangeCommitmentsNock = nock(bitgoApiUrl)
        .post(`/api/v2/wallet/${walletId}/txrequests/${tssTxRequestId}/transactions/0/commit`)
        .matchHeader('any', () => true)
        .reply(200, { commitmentShare: { share: 'bitgo-commitment-share' } });

      const offerRShareNock = nock(bitgoApiUrl)
        .post(
          `/api/v2/wallet/${walletId}/txrequests/${tssTxRequestId}/transactions/0/signatureshares`,
        )
        .matchHeader('any', () => true)
        .reply(200, { share: 'user-to-bitgo-r-share', from: 'bitgo', to: 'user' });

      nock(bitgoApiUrl)
        .persist()
        .get(`/api/v2/wallet/${walletId}/txrequests`)
        .query(true)
        .matchHeader('any', () => true)
        .reply(200, { txRequests: [signedTxRequest] });

      const sendGShareNock = nock(bitgoApiUrl)
        .post(
          `/api/v2/wallet/${walletId}/txrequests/${tssTxRequestId}/transactions/0/signatureshares`,
        )
        .matchHeader('any', () => true)
        .reply(200, { share: 'user-to-bitgo-g-share', from: 'bitgo', to: 'user' });

      const transferNock = nock(bitgoApiUrl)
        .post(`/api/v2/wallet/${walletId}/txrequests/${tssTxRequestId}/transfers`)
        .matchHeader('any', () => true)
        .reply(200, { state: 'signed' });

      const signMpcCommitmentNockAwm = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/mpc/sign/commitment`)
        .reply(200, {
          userToBitgoCommitment: { share: 'user-commitment-share' },
          encryptedSignerShare: { share: 'encrypted-signer-share' },
          encryptedUserToBitgoRShare: { share: 'encrypted-user-to-bitgo-r-share' },
          encryptedDataKey: 'test-encrypted-data-key',
        });

      const signMpcRShareNockAwm = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/mpc/sign/r`)
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
        .post(`/api/${coin}/mpc/sign/g`)
        .reply(200, {
          gShare: { r: 'r', gamma: 'gamma', i: 1, j: 3, n: 4 },
        });

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
          commonKeychain: 'test-common-keychain',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txRequest');
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction');

      capturedTxRequestBody!.should.have.property('intent');
      (capturedTxRequestBody!.intent as Record<string, unknown>).should.have.property(
        'intentType',
        'payment',
      );

      walletGetNock.done();
      createTxRequestNock.done();
      deleteSigSharesNock.done();
      exchangeCommitmentsNock.done();
      offerRShareNock.done();
      sendGShareNock.done();
      transferNock.done();
      signMpcCommitmentNockAwm.done();
      signMpcRShareNockAwm.done();
      signMpcGShareNockAwm.done();
    });
  });

  describe('SendMany TSS ECDSA:', () => {
    const coin = 'hteth';
    it('should send many transactions using ECDSA TSS signing', async () => {
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
          multisigTypeVersion: 'MPCv2',
        });

      const nocks = nockEcdsaMPCv2SigningFlow(
        coin,
        walletId,
        bitgoApiUrl,
        advancedWalletManagerUrl,
      );

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
          commonKeychain: 'test-common-keychain',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txRequest');
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction');

      walletGetNock.done();
      nocks.createTxRequestNock.done();
      nocks.round1SignNock.done();
      nocks.round2SignNock.done();
      nocks.round3SignNock.done();
      nocks.sendTxNock.done();
      nocks.transferNock.done();
      nocks.awmRound1Nock.done();
      nocks.awmRound2Nock.done();
      nocks.awmRound3Nock.done();
    });

    it('should be able to sign a fill nonce transaction', async () => {
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
          multisigTypeVersion: 'MPCv2',
        });

      const nocks = nockEcdsaMPCv2SigningFlow(
        coin,
        walletId,
        bitgoApiUrl,
        advancedWalletManagerUrl,
      );

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'fillNonce',
          nonce: '2',
          source: 'user',
          commonKeychain: 'test-common-keychain',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txRequest');
      response.body.should.have.property('txid', 'test-tx-id');
      response.body.should.have.property('tx', 'signed-transaction');

      walletGetNock.done();
      nocks.createTxRequestNock.done();
      nocks.round1SignNock.done();
      nocks.round2SignNock.done();
      nocks.round3SignNock.done();
      nocks.sendTxNock.done();
      nocks.transferNock.done();
      nocks.awmRound1Nock.done();
      nocks.awmRound2Nock.done();
      nocks.awmRound3Nock.done();
    });

    it('should fail when backup key is used for ECDSA TSS signing', async () => {
      // Mock wallet get request for TSS wallet
      const walletGetNock = nock(bitgoApiUrl)
        .get(`/api/v2/${coin}/wallet/${walletId}`)
        .matchHeader('any', () => true)
        .reply(200, {
          id: walletId,
          type: 'advanced',
          keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
          multisigType: 'tss',
          multisigTypeVersion: 'MPCv2',
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

      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          recipients: [
            {
              address: 'tb1qtest1',
              amount: '100000',
            },
          ],
          source: 'backup',
          commonKeychain: 'test-common-keychain',
        });

      response.status.should.equal(400);
      response.body.details.should.equal('Backup MPC signing not supported for sendMany');

      walletGetNock.done();
      keychainGetNock.done();
    });
  });

  it('should throw error when provided pubkey does not match wallet keychain', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'advanced',
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
        type: 'advanced',
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

    const prebuildBuildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    // Mock verifyTransaction to return false
    const verifyStub = sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(false);

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
    prebuildBuildNock.done();
    sinon.assert.calledOnce(verifyStub);
  });

  it('should fail when transaction verification throws an error', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'advanced',
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

    const prebuildBuildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    // Mock verifyTransaction to throw an error
    const verifyStub = sinon
      .stub(Tbtc.prototype, 'verifyTransaction')
      .rejects(new Error('Invalid transaction'));

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
    prebuildBuildNock.done();
    sinon.assert.calledOnce(verifyStub);
  });

  it('should handle BitGoApiResponseError correctly', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'advanced',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    // Mock keychain get request — user-key-id fetched twice (signing key + walletPubs)
    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .times(2)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
      });

    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('any', () => true)
      .reply(200, { id: 'backup-key-id', pub: 'xpub_backup' });

    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('any', () => true)
      .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo' });

    const prebuildBuildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    const verifyStub = sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

    // Mock enclaved express sign request to return an error
    const signNock = nock(advancedWalletManagerUrl).post(`/api/${coin}/multisig/sign`).reply(500, {
      error: 'Internal Server Error',
      details: 'Custom API error details',
    });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
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
    prebuildBuildNock.done();
    sinon.assert.calledOnce(verifyStub);
    signNock.done();
  });

  it('should throw error when pubkey is missing for multisig wallet', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'advanced',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType: 'onchain',
      });

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
      });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        recipients: [{ address: 'tb1qtest1', amount: '100000' }],
        source: 'user',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.equal('BadRequestError');
    response.body.details.should.equal('pubkey must be provided for multisig user signing');

    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should throw error when commonKeychain is missing for TSS wallet', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'advanced',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType: 'tss',
      });

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
        commonKeychain: 'test-common-keychain',
      });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        recipients: [{ address: 'tb1qtest1', amount: '100000' }],
        source: 'user',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.equal('BadRequestError');
    response.body.details.should.equal('commonKeychain must be provided for TSS user signing');

    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should ignore commonKeychain param for multisig wallet', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'advanced',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType: 'onchain',
      });

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .times(2)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
      });

    const backupKeychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'backup-key-id',
        pub: 'xpub_backup',
      });

    const bitgoKeychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'bitgo-key-id',
        pub: 'xpub_bitgo',
      });

    const prebuildBuildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    const verifyStub = sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

    const signNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: {
          txHex: 'signed-tx-hex',
          txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
        },
        walletId: 'test-wallet-id',
        source: 'user',
        pub: 'xpub_user',
      });

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .matchHeader('any', () => true)
      .reply(200, { txid: 'test-tx-id', status: 'signed' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/sendMany`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        recipients: [{ address: 'tb1qtest1', amount: '100000' }],
        source: 'user',
        pubkey: 'xpub_user',
        commonKeychain: 'some-irrelevant-value',
      });

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'test-tx-id');

    walletGetNock.done();
    keychainGetNock.done();
    backupKeychainGetNock.done();
    bitgoKeychainGetNock.done();
    prebuildBuildNock.done();
    sinon.assert.calledOnce(verifyStub);
    signNock.done();
    submitNock.done();
  });
});
