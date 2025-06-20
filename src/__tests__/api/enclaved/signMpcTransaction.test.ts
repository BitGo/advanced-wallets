import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as enclavedApp } from '../../../enclavedApp';
import { AppMode, EnclavedConfig, TlsMode } from '../../../initConfig';
import express from 'express';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import { Ed25519BIP32, Eddsa, SignatureShareType } from '@bitgo/sdk-core';

describe('signMpcTransaction', () => {
  let cfg: EnclavedConfig;
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
      appMode: AppMode.ENCLAVED,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      logFile: '',
      kmsUrl: kmsUrl,
      tlsMode: TlsMode.DISABLED,
      mtlsRequestCert: false,
      allowSelfSigned: true,
    };

    configStub = sinon.stub(configModule, 'initConfig').returns(cfg);

    // app setup
    app = enclavedApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
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

    it('should successfully do all signing rounds with EBE', async () => {
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
        bitgoGpgPubKey: bitgoGpgPubKey,
      };

      const mockDataKeyResponse = {
        plaintextKey: 'mock-plaintext-data-key',
        encryptedKey: 'mock-encrypted-data-key',
      };

      // Mock KMS responses
      const kmsNock = nock(kmsUrl)
        .get(`/key/${input.pub}`)
        .query({ source: 'user' })
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
        .query({ source: 'user' })
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
        .query({ source: 'user' })
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
        .query({ source: 'user' })
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
      };

      const kmsNock = nock(kmsUrl)
        .get(`/key/${input.pub}`)
        .query({ source: 'user' })
        .reply(200, mockKmsResponse);

      const response = await agent
        .post(`/api/${coin}/mpc/sign/invalid`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.details.should.equal(
        'Share type invalid not supported for EDDSA, only commitment, G and R share generation is supported.',
      );

      kmsNock.done();
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
});
