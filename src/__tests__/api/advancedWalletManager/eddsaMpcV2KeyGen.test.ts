import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../initConfig';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';

import express from 'express';
import nock from 'nock';
import should from 'should';
import * as request from 'supertest';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import { EddsaMPCv2Utils } from '@bitgo-beta/sdk-core';
import { MPCv2PartiesEnum } from '@bitgo-beta/sdk-core/dist/src/bitgo/utils/tss/ecdsa';

describe('eddsaMPCv2KeyGen', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'tsol';
  const accessToken = 'test-token';

  const sandbox = sinon.createSandbox();

  const signedMessage = {
    message: 'bWVzc2FnZQ==',
    signature: '-----BEGIN PGP SIGNATURE-----\n\ntest\n-----END PGP SIGNATURE-----\n',
  };

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      keyProviderUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    sandbox.stub(configModule, 'initConfig').returns(cfg);

    app = advancedWalletManagerApp(cfg);
    agent = request.agent(app);
  });

  beforeEach(() => {
    nock(keyProviderUrl)
      .post('/generateDataKey')
      .reply(200, {
        plaintextKey: 'test-plaintext-key',
        encryptedKey: 'test-encrypted-key',
      })
      .persist();
    nock(keyProviderUrl)
      .post('/decryptDataKey')
      .reply(200, {
        plaintextKey: 'test-plaintext-key',
      })
      .persist();
    nock(keyProviderUrl)
      .post('/key')
      .reply(200, {
        pub: 'test-pub-key',
        coin,
        source: 'user',
        type: 'tss',
      })
      .persist();
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  after(() => {
    nock.enableNetConnect();
  });

  it('initialize returns a GPG public key, the encrypted GPG private key and the encrypted data key', async () => {
    const response = await agent
      .post(`/api/${coin}/eddsampcv2/keygen/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(200);
    response.body.should.have.property('gpgPub').which.is.a.String();
    response.body.gpgPub.should.containEql('BEGIN PGP PUBLIC KEY');
    response.body.should.have.property('encryptedUserGpgPrvKey').which.is.a.String();
    response.body.encryptedUserGpgPrvKey.should.not.containEql('PRIVATE KEY');
    response.body.should.have.property('encryptedDataKey', 'test-encrypted-key');
  });

  it('round1 delegates to createOfflineKeyGenRound1Share with the source-derived partyId', async () => {
    const round1Stub = sandbox
      .stub(EddsaMPCv2Utils.prototype, 'createOfflineKeyGenRound1Share')
      .resolves({ signedMsg1: signedMessage, encryptedRound1Session: 'encrypted-round1-session' });

    const response = await agent
      .post(`/api/${coin}/eddsampcv2/keygen/round1`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedDataKey: 'test-encrypted-key',
        encryptedUserGpgPrvKey: 'encrypted-user-gpg-prv',
        bitgoGpgPubKey: 'bitgo-gpg-pub',
        counterPartyGpgPubKey: 'counterparty-gpg-pub',
      });

    response.status.should.equal(200);
    sinon.assert.calledOnce(round1Stub);
    sinon.assert.calledWith(round1Stub, {
      walletPassphrase: 'test-plaintext-key',
      encryptedUserGpgPrvKey: 'encrypted-user-gpg-prv',
      bitgoGpgPubKey: 'bitgo-gpg-pub',
      counterPartyGpgPubKey: 'counterparty-gpg-pub',
      partyId: MPCv2PartiesEnum.USER,
    });
    response.body.signedMsg1.should.deepEqual(signedMessage);
    response.body.should.have.property('encryptedRound1Session', 'encrypted-round1-session');
  });

  it('round1 passes MPCv2PartiesEnum.BACKUP for source backup', async () => {
    const round1Stub = sandbox
      .stub(EddsaMPCv2Utils.prototype, 'createOfflineKeyGenRound1Share')
      .resolves({ signedMsg1: signedMessage, encryptedRound1Session: 'encrypted-round1-session' });

    const response = await agent
      .post(`/api/${coin}/eddsampcv2/keygen/round1`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'backup',
        encryptedDataKey: 'test-encrypted-key',
        encryptedUserGpgPrvKey: 'encrypted-backup-gpg-prv',
        bitgoGpgPubKey: 'bitgo-gpg-pub',
        counterPartyGpgPubKey: 'counterparty-gpg-pub',
      });

    response.status.should.equal(200);
    sinon.assert.calledOnce(round1Stub);
    sinon.assert.calledWithMatch(round1Stub, { partyId: MPCv2PartiesEnum.BACKUP });
  });

  it('round2 delegates to createOfflineKeyGenRound2Share with the round 1 session and messages', async () => {
    const round2Stub = sandbox
      .stub(EddsaMPCv2Utils.prototype, 'createOfflineKeyGenRound2Share')
      .resolves({ signedMsg2: signedMessage, encryptedRound2Session: 'encrypted-round2-session' });

    const response = await agent
      .post(`/api/${coin}/eddsampcv2/keygen/round2`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedDataKey: 'test-encrypted-key',
        encryptedUserGpgPrvKey: 'encrypted-user-gpg-prv',
        encryptedRound1Session: 'encrypted-round1-session',
        bitgoGpgPubKey: 'bitgo-gpg-pub',
        counterPartyGpgPubKey: 'counterparty-gpg-pub',
        bitgoMsg1: signedMessage,
        counterPartyMsg1: signedMessage,
      });

    response.status.should.equal(200);
    sinon.assert.calledOnce(round2Stub);
    sinon.assert.calledWith(round2Stub, {
      walletPassphrase: 'test-plaintext-key',
      encryptedUserGpgPrvKey: 'encrypted-user-gpg-prv',
      encryptedRound1Session: 'encrypted-round1-session',
      bitgoGpgPubKey: 'bitgo-gpg-pub',
      counterPartyGpgPubKey: 'counterparty-gpg-pub',
      bitgoMsg1: signedMessage,
      counterPartyMsg1: signedMessage,
      partyId: MPCv2PartiesEnum.USER,
    });
    response.body.signedMsg2.should.deepEqual(signedMessage);
    response.body.should.have.property('encryptedRound2Session', 'encrypted-round2-session');
  });

  it('finalize delegates to createOfflineKeyGenFinalizeShare and stores the key share via postKey', async () => {
    nock.cleanAll();
    nock(keyProviderUrl)
      .post('/decryptDataKey')
      .reply(200, {
        plaintextKey: 'test-plaintext-key',
      })
      .persist();
    let postedKey: Record<string, unknown> | undefined;
    nock(keyProviderUrl)
      .post('/key')
      .reply(200, (_uri, body) => {
        if (typeof body === 'object' && body !== null) {
          postedKey = body;
        }
        return {
          pub: 'common-keychain',
          coin,
          source: 'user',
          type: 'tss',
        };
      });

    const finalizeStub = sandbox
      .stub(EddsaMPCv2Utils.prototype, 'createOfflineKeyGenFinalizeShare')
      .resolves({ commonKeychain: 'common-keychain', keyShare: 'a2V5LXNoYXJl' });

    const response = await agent
      .post(`/api/${coin}/eddsampcv2/keygen/finalize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedDataKey: 'test-encrypted-key',
        encryptedRound2Session: 'encrypted-round2-session',
        bitgoGpgPubKey: 'bitgo-gpg-pub',
        counterPartyGpgPubKey: 'counterparty-gpg-pub',
        bitgoMsg2: signedMessage,
        counterPartyMsg2: signedMessage,
        bitgoCommonKeychain: 'common-keychain',
      });

    response.status.should.equal(200);
    sinon.assert.calledOnce(finalizeStub);
    sinon.assert.calledWith(finalizeStub, {
      walletPassphrase: 'test-plaintext-key',
      encryptedRound2Session: 'encrypted-round2-session',
      bitgoGpgPubKey: 'bitgo-gpg-pub',
      counterPartyGpgPubKey: 'counterparty-gpg-pub',
      bitgoMsg2: signedMessage,
      counterPartyMsg2: signedMessage,
      bitgoCommonKeychain: 'common-keychain',
      partyId: MPCv2PartiesEnum.USER,
    });
    response.body.should.deepEqual({ commonKeychain: 'common-keychain', source: 'user' });
    if (!postedKey) {
      throw new Error('postKey was not called');
    }
    should(postedKey.coin).equal(coin);
    should(postedKey.source).equal('user');
    should(postedKey.pub).equal('common-keychain');
    should(postedKey.prv).equal('a2V5LXNoYXJl');
    should(postedKey.type).equal('tss');
  });

  it('rejects an unsupported share type', async () => {
    const response = await agent
      .post(`/api/${coin}/eddsampcv2/keygen/bogus`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(400);
  });

  it('rejects round1 with missing required fields', async () => {
    const response = await agent
      .post(`/api/${coin}/eddsampcv2/keygen/round1`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user', encryptedDataKey: 'test-encrypted-key' });

    response.status.should.equal(400);
  });
});
