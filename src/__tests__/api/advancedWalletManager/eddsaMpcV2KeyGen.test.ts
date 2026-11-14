import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../initConfig';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';

import express from 'express';
import nock from 'nock';
import 'should';
import * as request from 'supertest';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import { EddsaMPCv2Utils } from '@bitgo-beta/sdk-core';
import { MPCv2PartiesEnum } from '@bitgo-beta/sdk-core/dist/src/bitgo/utils/tss/ecdsa';

describe('EdDSA MPCv2 key generation (v1.mpcv2.* routes)', () => {
  let cfg: AdvancedWalletManagerConfig;
  let agent: request.SuperAgentTest;

  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'tsol';
  const accessToken = 'test-token';
  const sandbox = sinon.createSandbox(); // initConfig, for the whole suite
  const stubs = sinon.createSandbox(); // per-test SDK stubs

  const signedMsg = (tag: string) => ({
    message: Buffer.from(tag).toString('base64'),
    signature: `sig-${tag}`,
  });
  const bitgoGpgPub = 'bitgo-gpg-pub';
  const counterPartyGpgPub = 'counterparty-gpg-pub';

  let round1Stub: sinon.SinonStub;
  let round2Stub: sinon.SinonStub;
  let finalizeStub: sinon.SinonStub;
  let postKeyBody: Record<string, unknown> | undefined;

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
    agent = request.agent(advancedWalletManagerApp(cfg) as express.Application);
  });

  beforeEach(() => {
    postKeyBody = undefined;
    nock(keyProviderUrl)
      .post('/generateDataKey')
      .reply(200, { plaintextKey: 'test-plaintext-key', encryptedKey: 'test-encrypted-key' })
      .persist();
    nock(keyProviderUrl)
      .post('/decryptDataKey')
      .reply(200, { plaintextKey: 'test-plaintext-key' })
      .persist();
    nock(keyProviderUrl)
      .post('/key')
      .reply(200, (_uri, body) => {
        postKeyBody = body as Record<string, unknown>;
        return { pub: postKeyBody.pub, coin, source: postKeyBody.source, type: 'tss' };
      })
      .persist();

    round1Stub = stubs
      .stub(EddsaMPCv2Utils.prototype, 'createOfflineKeyGenRound1Share')
      .resolves({ signedMsg1: signedMsg('r1'), encryptedRound1Session: 'enc-round1-session' });
    round2Stub = stubs
      .stub(EddsaMPCv2Utils.prototype, 'createOfflineKeyGenRound2Share')
      .resolves({ signedMsg2: signedMsg('r2'), encryptedRound2Session: 'enc-round2-session' });
    finalizeStub = stubs
      .stub(EddsaMPCv2Utils.prototype, 'createOfflineKeyGenFinalizeShare')
      .resolves({ commonKeychain: 'common-keychain', keyShare: 'key-share' });
  });

  afterEach(() => {
    nock.cleanAll();
    stubs.restore();
  });

  after(() => {
    sandbox.restore();
  });

  const post = (path: string, body: object, c = coin) =>
    agent.post(`/api/${c}/mpcv2/${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);

  const initialize = async (source: 'user' | 'backup' = 'user') => {
    const res = await post('initialize', { source });
    res.status.should.equal(200);
    return res.body;
  };

  const round1 = async (source: 'user' | 'backup' = 'user') => {
    const init = await initialize(source);
    const res = await post('round', {
      source,
      encryptedData: init.encryptedData,
      encryptedDataKey: init.encryptedDataKey,
      round: 1,
      bitgoGpgPub,
      counterPartyGpgPub,
    });
    res.status.should.equal(200);
    return res.body;
  };

  describe('initialize', () => {
    it('returns an ed25519 GPG public key and encrypted state', async () => {
      const body = await initialize();
      body.gpgPub.should.containEql('BEGIN PGP PUBLIC KEY BLOCK');
      body.encryptedData.should.be.a.String();
      body.encryptedDataKey.should.equal('test-encrypted-key');
    });
  });

  describe('round', () => {
    it('round 1 delegates to createOfflineKeyGenRound1Share and returns the signed message', async () => {
      const body = await round1();
      body.round.should.equal(2);
      body.signedMsg.should.deepEqual(signedMsg('r1'));
      body.should.not.have.property('broadcastMessage');

      const args = round1Stub.firstCall.args[0];
      args.walletPassphrase.should.equal('test-plaintext-key');
      args.bitgoGpgPubKey.should.equal(bitgoGpgPub);
      args.counterPartyGpgPubKey.should.equal(counterPartyGpgPub);
      args.encryptedUserGpgPrvKey.should.be.a.String();
      args.partyId.should.equal(MPCv2PartiesEnum.USER);
    });

    it('derives the DKG party id from the source', async () => {
      await round1('backup');
      round1Stub.firstCall.args[0].partyId.should.equal(MPCv2PartiesEnum.BACKUP);
    });

    it('round 2 restores state from round 1 and delegates to createOfflineKeyGenRound2Share', async () => {
      const r1 = await round1();
      const res = await post('round', {
        source: 'user',
        encryptedData: r1.encryptedData,
        encryptedDataKey: r1.encryptedDataKey,
        round: 2,
        bitgoMsg: signedMsg('bitgo1'),
        counterPartyMsg: signedMsg('counterparty1'),
      });
      res.status.should.equal(200);
      res.body.round.should.equal(3);
      res.body.signedMsg.should.deepEqual(signedMsg('r2'));

      const args = round2Stub.firstCall.args[0];
      args.encryptedRound1Session.should.equal('enc-round1-session');
      args.bitgoGpgPubKey.should.equal(bitgoGpgPub);
      args.counterPartyGpgPubKey.should.equal(counterPartyGpgPub);
      args.bitgoMsg1.should.deepEqual(signedMsg('bitgo1'));
      args.counterPartyMsg1.should.deepEqual(signedMsg('counterparty1'));
      args.partyId.should.equal(MPCv2PartiesEnum.USER);
    });

    it('rejects round 1 without GPG public keys', async () => {
      const init = await initialize();
      const res = await post('round', {
        source: 'user',
        encryptedData: init.encryptedData,
        encryptedDataKey: init.encryptedDataKey,
        round: 1,
      });
      res.status.should.equal(400);
      round1Stub.called.should.be.false();
    });

    it('rejects round 2 without the signed messages', async () => {
      const r1 = await round1();
      const res = await post('round', {
        source: 'user',
        encryptedData: r1.encryptedData,
        encryptedDataKey: r1.encryptedDataKey,
        round: 2,
        bitgoMsg: signedMsg('bitgo1'),
      });
      res.status.should.equal(400);
      round2Stub.called.should.be.false();
    });

    it('rejects rounds outside 1-2 for EdDSA', async () => {
      const r1 = await round1();
      const res = await post('round', {
        source: 'user',
        encryptedData: r1.encryptedData,
        encryptedDataKey: r1.encryptedDataKey,
        round: 3,
        bitgoMsg: signedMsg('bitgo1'),
        counterPartyMsg: signedMsg('counterparty1'),
      });
      res.status.should.equal(400);
    });

    it('rejects round 2 when round 1 was skipped', async () => {
      const init = await initialize();
      const res = await post('round', {
        source: 'user',
        encryptedData: init.encryptedData,
        encryptedDataKey: init.encryptedDataKey,
        round: 2,
        bitgoMsg: signedMsg('bitgo1'),
        counterPartyMsg: signedMsg('counterparty1'),
      });
      res.status.should.equal(400);
      round2Stub.called.should.be.false();
    });
  });

  describe('finalize', () => {
    const runToFinalize = async (source: 'user' | 'backup' = 'user') => {
      const r1 = await round1(source);
      const r2 = await post('round', {
        source,
        encryptedData: r1.encryptedData,
        encryptedDataKey: r1.encryptedDataKey,
        round: 2,
        bitgoMsg: signedMsg('bitgo1'),
        counterPartyMsg: signedMsg('counterparty1'),
      });
      r2.status.should.equal(200);
      return r2.body;
    };

    it('delegates to createOfflineKeyGenFinalizeShare and stores the key share', async () => {
      const r2 = await runToFinalize();
      const res = await post('finalize', {
        source: 'user',
        encryptedData: r2.encryptedData,
        encryptedDataKey: r2.encryptedDataKey,
        bitgoCommonKeychain: 'bitgo-common-keychain',
        bitgoMsg: signedMsg('bitgo2'),
        counterPartyMsg: signedMsg('counterparty2'),
      });
      res.status.should.equal(200);
      res.body.should.deepEqual({ source: 'user', commonKeychain: 'common-keychain' });

      const args = finalizeStub.firstCall.args[0];
      args.encryptedRound2Session.should.equal('enc-round2-session');
      args.bitgoCommonKeychain.should.equal('bitgo-common-keychain');
      args.bitgoMsg2.should.deepEqual(signedMsg('bitgo2'));
      args.counterPartyMsg2.should.deepEqual(signedMsg('counterparty2'));

      (postKeyBody as Record<string, unknown>).should.containEql({
        pub: 'common-keychain',
        prv: 'key-share',
        coin,
        source: 'user',
        type: 'tss',
      });
    });

    it('rejects finalize without the signed messages', async () => {
      const r2 = await runToFinalize();
      const res = await post('finalize', {
        source: 'user',
        encryptedData: r2.encryptedData,
        encryptedDataKey: r2.encryptedDataKey,
        bitgoCommonKeychain: 'bitgo-common-keychain',
      });
      res.status.should.equal(400);
      finalizeStub.called.should.be.false();
      (postKeyBody === undefined).should.be.true();
    });

    it('rejects finalize when round 2 was skipped', async () => {
      const r1 = await round1();
      const res = await post('finalize', {
        source: 'user',
        encryptedData: r1.encryptedData,
        encryptedDataKey: r1.encryptedDataKey,
        bitgoCommonKeychain: 'bitgo-common-keychain',
        bitgoMsg: signedMsg('bitgo2'),
        counterPartyMsg: signedMsg('counterparty2'),
      });
      res.status.should.equal(400);
      finalizeStub.called.should.be.false();
    });
  });

  describe('ECDSA routing is unchanged', () => {
    it('rejects ECDSA finalize without broadcastMessages', async () => {
      const res = await post(
        'finalize',
        {
          source: 'user',
          encryptedData: 'x',
          encryptedDataKey: 'y',
          bitgoCommonKeychain: 'z',
        },
        'hteth',
      );
      res.status.should.equal(400);
      res.body.details.should.containEql('broadcastMessages');
    });
  });
});
