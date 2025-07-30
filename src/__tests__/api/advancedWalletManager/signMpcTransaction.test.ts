import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../shared/types';
import express from 'express';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import { Ed25519BIP32, Eddsa, SignatureShareType } from '@bitgo-beta/sdk-core';
import { TxRequest } from '@bitgo/public-types';
import { DklsUtils, DklsDsg, DklsTypes } from '@bitgo-beta/sdk-lib-mpc';
import assert from 'assert';
import { signBitgoMPCv2Round1, signBitgoMPCv2Round2, signBitgoMPCv2Round3 } from './ecdsaUtils';
import { Hash } from 'crypto';
import createKeccakHash from 'keccak';
import { bitgoGpgKey } from '../../mocks/gpgKeys';

describe('signMpcTransaction', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test config
  const kmsUrl = 'http://kms.invalid';
  const coin = 'tsol';
  const accessToken = 'test-token';

  // sinon stubs
  let configStub: sinon.SinonStub;

  before(() => {
    // nock config
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      kmsUrl: kmsUrl,
      tlsMode: TlsMode.DISABLED,
      allowSelfSigned: true,
    };

    configStub = sinon.stub(configModule, 'initConfig').returns(cfg);

    // app setup
    app = advancedWalletManagerApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  after(() => {
    configStub.restore();
  });

  const mockTxRequest = {
    apiVersion: 'full',
    walletId: '68489ecff6fb16304670b327db8eb31a',
    transactions: [
      {
        unsignedTx: {
          derivationPath: 'm/0',
          signableHex: 'testMessage',
        },
      },
    ],
  };

  describe('EDDSA MPC Signing Integration Tests', () => {
    let hdTree: Ed25519BIP32;
    let MPC: Eddsa;
    let bitgoGpgPubKey: string;

    before(async () => {
      hdTree = await Ed25519BIP32.initialize();
      MPC = await Eddsa.initialize(hdTree);
      bitgoGpgPubKey =
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
        '\n' +
        'xk8EZo2rshMFK4EEAAoCAwQC6HQa7PXiX2nnpZr/asCcEbgCOcjsR8gcSI8v\n' +
        'vMADk59KsFweg+kIzCR3UqfMe2uG6JHwOYpvDREHp/hqtA+hzQViaXRnb8KM\n' +
        'BBATCAA+BYJmjauyBAsJBwgJkDwRkYkILA84AxUICgQWAAIBAhkBApsDAh4B\n' +
        'FiEEtIZR46psznKbhpKePBGRiQgsDzgAAFehAP4qQ7mRYbDwaBY3Xja36kZQ\n' +
        's8vMajrfnesfwXCArF72KQEAoSMkjXtpWWjMbRHMVXFy0EstWqNg7m0FlCGh\n' +
        'BsceQZ3OUwRmjauyEgUrgQQACgIDBMHCYxr6G1SaNSiqUpO5BqhZxjQN6355\n' +
        '7/p9X36+eKwTKmFFQVecDQrQvIalKc2WoqKxKgCvBSRlOJbBNsxaNN0DAQgH\n' +
        'wngEGBMIACoFgmaNq7IJkDwRkYkILA84ApsMFiEEtIZR46psznKbhpKePBGR\n' +
        'iQgsDzgAAN/+AQCKM7sRdSRKEkF3vGBSBaqMMAolcK9iujaqkZ/phjNTYwEA\n' +
        'mFiLGavuPlAgSCknFZJ0xrrtlLXeWTMjWGU1gsS5Pfo=\n' +
        '=7uRX\n' +
        '-----END PGP PUBLIC KEY BLOCK-----\n';
    });

    it('should successfully do all signing rounds with AWM', async () => {
      const user = MPC.keyShare(1, 2, 3);
      const backup = MPC.keyShare(2, 2, 3);
      const bitgo = MPC.keyShare(3, 2, 3);

      const userSigningMaterial = {
        uShare: user.uShare,
        bitgoYShare: bitgo.yShares[1],
        backupYShare: backup.yShares[1],
      };

      const mockKmsResponse = {
        prv: JSON.stringify(userSigningMaterial),
        pub: 'DSqMPMsMAbEJVNuPKv1ZFdzt6YvJaDPDddfeW7ajtqds',
        source: 'user',
        type: 'independent',
      };

      const input = {
        source: 'user',
        pub: 'DSqMPMsMAbEJVNuPKv1ZFdzt6YvJaDPDddfeW7ajtqds',
        txRequest: mockTxRequest,
        bitgoPublicGpgKey: bitgoGpgPubKey,
      };

      const mockDataKeyResponse = {
        plaintextKey: 'mock-plaintext-data-key',
        encryptedKey: 'mock-encrypted-data-key',
      };

      // Mock KMS responses
      const kmsNock = nock(kmsUrl)
        .get(`/key/${input.pub}`)
        .query({ source: 'user', useLocalEncipherment: false })
        .reply(200, mockKmsResponse);

      const dataKeyNock = nock(kmsUrl).post('/generateDataKey').reply(200, mockDataKeyResponse);

      const response = await agent
        .post(`/api/${coin}/mpc/sign/commitment`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(200);
      response.body.should.have.property('userToBitgoCommitment');
      response.body.should.have.property('encryptedSignerShare');
      response.body.should.have.property('encryptedUserToBitgoRShare');
      response.body.should.have.property('encryptedDataKey');

      kmsNock.done();
      dataKeyNock.done();

      // Continue with R share test using the returned encryptedUserToBitgoRShare
      const encryptedUserToBitgoRShare = response.body.encryptedUserToBitgoRShare;
      const encryptedDataKey = response.body.encryptedDataKey;

      const rInput = {
        source: 'user',
        pub: 'DSqMPMsMAbEJVNuPKv1ZFdzt6YvJaDPDddfeW7ajtqds',
        txRequest: mockTxRequest,
        encryptedUserToBitgoRShare,
        encryptedDataKey,
      };

      const mockDecryptedDataKeyResponse = {
        plaintextKey: 'mock-plaintext-data-key',
      };

      // Mock KMS responses for R share
      const rKmsNock = nock(kmsUrl)
        .get(`/key/${rInput.pub}`)
        .query({ source: 'user', useLocalEncipherment: false })
        .reply(200, mockKmsResponse);

      const decryptDataKeyNock = nock(kmsUrl)
        .post('/decryptDataKey')
        .reply(200, mockDecryptedDataKeyResponse);

      const rResponse = await agent
        .post(`/api/${coin}/mpc/sign/r`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(rInput);

      rResponse.status.should.equal(200);
      rResponse.body.should.have.property('rShare');

      rKmsNock.done();
      decryptDataKeyNock.done();

      // Continue with G share test using the returned rShare
      const rShare = rResponse.body.rShare;
      const derivationPath = 'm/0';
      const tMessage = 'testMessage';

      // Derive signing key and create bitgo sign share
      const signingKey = MPC.keyDerive(
        userSigningMaterial.uShare,
        [userSigningMaterial.bitgoYShare, userSigningMaterial.backupYShare],
        derivationPath,
      );

      const bitgoCombine = MPC.keyCombine(bitgo.uShare, [signingKey.yShares[3], backup.yShares[3]]);
      const bitgoSignShare = await MPC.signShare(
        Buffer.from(tMessage, 'hex'),
        bitgoCombine.pShare,
        [bitgoCombine.jShares[1]],
      );

      const signatureShareRec = {
        from: SignatureShareType.BITGO,
        to: SignatureShareType.USER,
        share: bitgoSignShare.rShares[1].r + bitgoSignShare.rShares[1].R,
      };

      const bitgoToUserCommitmentShare = {
        from: SignatureShareType.BITGO,
        to: SignatureShareType.USER,
        share: bitgoSignShare.rShares[1].commitment,
        type: 'commitment',
      };

      const gInput = {
        source: 'user',
        pub: 'DSqMPMsMAbEJVNuPKv1ZFdzt6YvJaDPDddfeW7ajtqds',
        txRequest: mockTxRequest,
        userToBitgoRShare: rShare,
        bitgoToUserRShare: signatureShareRec,
        bitgoToUserCommitment: bitgoToUserCommitmentShare,
      };

      // Mock KMS response for G share
      const gKmsNock = nock(kmsUrl)
        .get(`/key/${gInput.pub}`)
        .query({ source: 'user', useLocalEncipherment: false })
        .reply(200, mockKmsResponse);

      const gResponse = await agent
        .post(`/api/${coin}/mpc/sign/g`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(gInput);

      gResponse.status.should.equal(200);
      gResponse.body.should.have.property('gShare');
      gResponse.body.gShare.should.have.property('i');
      gResponse.body.gShare.should.have.property('y');
      gResponse.body.gShare.should.have.property('gamma');
      gResponse.body.gShare.should.have.property('R');

      gKmsNock.done();
    });

    it('should fail when KMS returns no private key', async () => {
      const input = {
        source: 'user',
        pub: 'DSqMPMsMAbEJVNuPKv1ZFdzt6YvJaDPDddfeW7ajtqds',
        txRequest: mockTxRequest,
        bitgoGpgPubKey: bitgoGpgPubKey,
      };

      const kmsNock = nock(kmsUrl)
        .get(`/key/${input.pub}`)
        .query({ source: 'user', useLocalEncipherment: false })
        .reply(404, { error: 'Key not found' });

      const response = await agent
        .post(`/api/${coin}/mpc/sign/commitment`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(500);
      response.body.should.have.property('error');
      kmsNock.done();
    });

    it('should fail for unsupported share type', async () => {
      const input = {
        source: 'user',
        pub: 'DSqMPMsMAbEJVNuPKv1ZFdzt6YvJaDPDddfeW7ajtqds',
        txRequest: mockTxRequest,
      };

      const response = await agent
        .post(`/api/${coin}/mpc/sign/invalid`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(400);
      response.body.should.have.property('error');
    });

    it('should fail when required fields are missing', async () => {
      const input = {
        source: 'user',
        pub: 'DSqMPMsMAbEJVNuPKv1ZFdzt6YvJaDPDddfeW7ajtqds',
        // Missing txRequest and bitgoGpgPubKey for commitment
      };

      const response = await agent
        .post(`/api/${coin}/mpc/sign/commitment`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(500);
      response.body.should.have.property('error');
    });
  });

  describe('ECDSA MPCv2 Signing Integration Tests', () => {
    const coin = 'hteth'; // Use hteth for ECDSA testing

    it('should successfully complete all MPCv2 rounds', async () => {
      const walletID = '62fe536a6b4cf70007acb48c0e7bb0b0';
      const tMessage = 'testMessage';
      const derivationPath = 'm/0';

      const [userShare, backupShare, bitgoShare] = await DklsUtils.generateDKGKeyShares();
      assert(backupShare, 'Backup share is not defined');

      const userKeyShare = userShare.getKeyShare().toString('base64');

      const mockKmsResponse = {
        prv: JSON.stringify(userKeyShare),
        pub: 'mock-ecdsa-public-key',
        source: 'user',
        type: 'independent',
      };

      const mockTxRequest: TxRequest = {
        txRequestId: '123456',
        apiVersion: 'full',
        walletId: walletID,
        transactions: [
          {
            unsignedTx: {
              derivationPath,
              signableHex: tMessage,
              serializedTxHex: tMessage,
            },
            signatureShares: [],
            state: 'initialized',
          },
        ],
        walletType: 'cold',
        state: 'initialized',
        date: new Date().toISOString(),
        signatureShares: [],
        version: 1,
        userId: '123456',
        intent: 'sign',
        policiesChecked: true,
        pendingApprovalId: '123456',
        pendingTxHashes: [],
        txHashes: [],
        unsignedTxs: [],
        latest: true,
      };

      // Round 1 test
      const round1Input = {
        source: 'user',
        pub: 'mock-ecdsa-public-key',
        txRequest: mockTxRequest,
        bitgoPublicGpgKey: bitgoGpgKey.public,
      };

      const mockDataKeyResponse = {
        plaintextKey: 'mock-plaintext-data-key',
        encryptedKey: 'mock-encrypted-data-key',
      };

      // Mock KMS responses for Round 1
      const kmsNock = nock(kmsUrl)
        .get(`/key/${round1Input.pub}`)
        .query({ source: 'user', useLocalEncipherment: true })
        .reply(200, mockKmsResponse);

      const dataKeyNock = nock(kmsUrl).post('/generateDataKey').reply(200, mockDataKeyResponse);

      /* Signing Round 1 with User Key */
      const round1Response = await agent
        .post(`/api/${coin}/mpc/sign/mpcv2round1`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(round1Input);

      round1Response.status.should.equal(200);
      round1Response.body.should.have.property('signatureShareRound1');
      round1Response.body.should.have.property('userGpgPubKey');
      round1Response.body.should.have.property('encryptedRound1Session');
      round1Response.body.should.have.property('encryptedUserGpgPrvKey');
      round1Response.body.should.have.property('encryptedDataKey');

      kmsNock.done();
      dataKeyNock.done();

      /* Signing Round 1 with Bitgo Key */

      const hashFn = createKeccakHash('keccak256') as Hash;
      const hashBuffer = hashFn.update(Buffer.from(tMessage, 'hex')).digest();
      const bitgoSession = new DklsDsg.Dsg(bitgoShare.getKeyShare(), 2, derivationPath, hashBuffer);

      const txRequestRound1 = await signBitgoMPCv2Round1(
        bitgoSession,
        mockTxRequest,
        round1Response.body.signatureShareRound1,
        round1Response.body.userGpgPubKey,
      );
      assert(
        txRequestRound1.transactions &&
          txRequestRound1.transactions.length === 1 &&
          txRequestRound1.transactions[0].signatureShares.length === 2,
        'txRequestRound2.transactions is not an array of length 1 with 2 signatureShares',
      );

      // Round 2 Signing with User Key
      const encryptedDataKey = round1Response.body.encryptedDataKey;
      const encryptedUserGpgPrvKey = round1Response.body.encryptedUserGpgPrvKey;
      const encryptedRound1Session = round1Response.body.encryptedRound1Session;

      const round2Input = {
        source: 'user',
        pub: 'mock-ecdsa-public-key',
        txRequest: txRequestRound1,
        bitgoPublicGpgKey: bitgoGpgKey.public,
        encryptedDataKey,
        encryptedUserGpgPrvKey,
        encryptedRound1Session,
      };

      const mockDecryptedDataKeyResponse = {
        plaintextKey: 'mock-plaintext-data-key',
      };

      // Mock KMS responses for Round 2
      const r2KmsNock = nock(kmsUrl)
        .get(`/key/${round2Input.pub}`)
        .query({ source: 'user', useLocalEncipherment: true })
        .reply(200, mockKmsResponse);

      const decryptDataKeyNock = nock(kmsUrl)
        .post('/decryptDataKey')
        .reply(200, mockDecryptedDataKeyResponse);

      const round2Response = await agent
        .post(`/api/${coin}/mpc/sign/mpcv2round2`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(round2Input);

      round2Response.status.should.equal(200);
      round2Response.body.should.have.property('signatureShareRound2');
      round2Response.body.should.have.property('encryptedRound2Session');
      r2KmsNock.done();
      decryptDataKeyNock.done();

      // Round 2 Signing with Bitgo Key
      const { txRequest: txRequestRound2, bitgoMsg4 } = await signBitgoMPCv2Round2(
        bitgoSession,
        txRequestRound1,
        round2Response.body.signatureShareRound2,
        round1Response.body.userGpgPubKey,
      );
      assert(
        txRequestRound2.transactions &&
          txRequestRound2.transactions.length === 1 &&
          txRequestRound2.transactions[0].signatureShares.length === 4,
        'txRequestRound2.transactions is not an array of length 1 with 4 signatureShares',
      );

      // Round 3 Signing with User Key
      const encryptedRound2Session = round2Response.body.encryptedRound2Session;

      const round3Input = {
        source: 'user',
        pub: 'mock-ecdsa-public-key',
        txRequest: txRequestRound2,
        bitgoPublicGpgKey: bitgoGpgKey.public,
        encryptedDataKey,
        encryptedUserGpgPrvKey,
        encryptedRound2Session,
      };

      // Mock KMS responses for Round 3
      const r3KmsNock = nock(kmsUrl)
        .get(`/key/${round3Input.pub}`)
        .query({ source: 'user', useLocalEncipherment: true })
        .reply(200, mockKmsResponse);

      const r3DecryptDataKeyNock = nock(kmsUrl)
        .post('/decryptDataKey')
        .reply(200, mockDecryptedDataKeyResponse);

      const round3Response = await agent
        .post(`/api/${coin}/mpc/sign/mpcv2round3`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(round3Input);

      round3Response.status.should.equal(200);
      round3Response.body.should.have.property('signatureShareRound3');

      r3KmsNock.done();
      r3DecryptDataKeyNock.done();

      const { userMsg4 } = await signBitgoMPCv2Round3(
        bitgoSession,
        round3Response.body.signatureShareRound3,
        round1Response.body.userGpgPubKey,
      );
      assert(userMsg4, 'userMsg4 is not defined');

      // signature generation and validation
      assert(
        userMsg4.data.msg4.signatureR === bitgoMsg4.signatureR,
        'User and BitGo signaturesR do not match',
      );

      const deserializedBitgoMsg4 = DklsTypes.deserializeMessages({
        p2pMessages: [],
        broadcastMessages: [bitgoMsg4],
      });

      const deserializedUserMsg4 = DklsTypes.deserializeMessages({
        p2pMessages: [],
        broadcastMessages: [
          {
            from: userMsg4.data.msg4.from,
            payload: userMsg4.data.msg4.message,
          },
        ],
      });

      const combinedSigUsingUtil = DklsUtils.combinePartialSignatures(
        [
          deserializedUserMsg4.broadcastMessages[0].payload,
          deserializedBitgoMsg4.broadcastMessages[0].payload,
        ],
        Buffer.from(userMsg4.data.msg4.signatureR, 'base64').toString('hex'),
      );

      const convertedSignature = DklsUtils.verifyAndConvertDklsSignature(
        Buffer.from(tMessage, 'hex'),
        combinedSigUsingUtil,
        DklsTypes.getCommonKeychain(userShare.getKeyShare()),
        derivationPath,
        createKeccakHash('keccak256') as Hash,
      );
      assert(convertedSignature, 'Signature is not valid');
      assert(convertedSignature.split(':').length === 4, 'Signature is not valid');
    });

    it('should fail when required fields are missing for Round 2', async () => {
      const mockKmsResponse = {
        prv: 'mock-ecdsa-private-key',
        pub: 'mock-ecdsa-public-key',
        source: 'user',
        type: 'independent',
      };

      const input = {
        source: 'user',
        pub: 'mock-ecdsa-public-key',
        txRequest: mockTxRequest,
        // Missing encryptedDataKey, encryptedUserGpgPrvKey, encryptedRound1Session
      };

      const kmsNock = nock(kmsUrl)
        .get(`/key/${input.pub}`)
        .query({ source: 'user', useLocalEncipherment: true })
        .reply(200, mockKmsResponse);

      const response = await agent
        .post(`/api/${coin}/mpc/sign/mpcv2round2`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.details.should.equal(
        'encryptedDataKey from Round 1 is required for MPCv2 Round 2',
      );

      kmsNock.done();
    });

    it('should fail when required fields are missing for Round 3', async () => {
      const mockKmsResponse = {
        prv: 'mock-ecdsa-private-key',
        pub: 'mock-ecdsa-public-key',
        source: 'user',
        type: 'independent',
      };

      const input = {
        source: 'user',
        pub: 'mock-ecdsa-public-key',
        txRequest: mockTxRequest,
        encryptedDataKey: 'mock-encrypted-data-key',
        // Missing bitgoGpgPubKey, encryptedUserGpgPrvKey, encryptedRound2Session
      };

      const kmsNock = nock(kmsUrl)
        .get(`/key/${input.pub}`)
        .query({ source: 'user', useLocalEncipherment: true })
        .reply(200, mockKmsResponse);

      const response = await agent
        .post(`/api/${coin}/mpc/sign/mpcv2round3`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.details.should.equal('bitgoGpgPubKey is required for MPCv2 Round 3');

      kmsNock.done();
    });

    it('should fail for unsupported share type', async () => {
      const input = {
        source: 'user',
        pub: 'mock-ecdsa-public-key',
        txRequest: mockTxRequest,
      };

      const response = await agent
        .post(`/api/${coin}/mpc/sign/invalid`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(400);
      response.body.should.have.property('error');
    });
  });
});
