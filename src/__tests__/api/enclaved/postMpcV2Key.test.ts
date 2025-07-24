import { AppMode, EnclavedConfig, TlsMode } from '../../../initConfig';
import { app as enclavedApp } from '../../../enclavedApp';

import express from 'express';
import nock from 'nock';
import 'should';
import * as request from 'supertest';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import * as bitgoSdk from '@bitgo/sdk-core';
import { DklsComms, DklsDkg, DklsTypes } from '@bitgo-beta/sdk-lib-mpc';
import { MPCv2PartiesEnum } from '@bitgo/sdk-core/dist/src/bitgo/utils/tss/ecdsa';

describe('postMpcV2Key', () => {
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
      httpLoggerFile: '',
      kmsUrl: kmsUrl,
      tlsMode: TlsMode.DISABLED,
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

  it('should be able to create a new MPC V2 wallet', async () => {
    // nocks for KMS responses
    nock(kmsUrl)
      .post(`/generateDataKey`)
      .reply(200, {
        plaintextKey: 'test-plaintext-key',
        encryptedKey: 'test-encrypted-key',
      })
      .persist();
    nock(kmsUrl)
      .post(`/decryptDataKey`)
      .reply(200, {
        plaintextKey: 'test-plaintext-key',
      })
      .persist();

    nock(kmsUrl)
      .post(`/key`)
      .reply(200, {
        pub: 'test-pub-key',
        coin,
        source: 'user',
        type: 'tss',
      })
      .persist();

    nock(kmsUrl)
      .post(`/key`)
      .reply(200, {
        pub: 'test-pub-key',
        coin,
        source: 'backup',
        type: 'tss',
      })
      .persist();

    nock(kmsUrl).post(`/postKey`).reply(200, {}).persist();

    // mocking bitgo's GPG key generation session
    const bitgoGpgKey = await bitgoSdk.generateGPGKeyPair('secp256k1');
    const bitgoGpgPub = {
      partyId: MPCv2PartiesEnum.BITGO,
      gpgKey: bitgoGpgKey.publicKey,
    };
    const bitgoGpgPrv = {
      partyId: MPCv2PartiesEnum.BITGO,
      gpgKey: bitgoGpgKey.privateKey,
    };
    const bitgoSession = new DklsDkg.Dkg(3, 2, MPCv2PartiesEnum.BITGO);

    // init
    const userInitResponse = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    const backupInitResponse = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'backup' });

    // verify init responses
    userInitResponse.status.should.equal(200);
    userInitResponse.body.should.have.property('gpgPub');
    userInitResponse.body.should.have.property('encryptedDataKey');
    userInitResponse.body.should.have.property('encryptedData');
    userInitResponse.body.encryptedDataKey.should.not.equal('test-plaintext-key');

    backupInitResponse.status.should.equal(200);
    backupInitResponse.body.should.have.property('gpgPub');
    backupInitResponse.body.should.have.property('encryptedDataKey');
    backupInitResponse.body.should.have.property('encryptedData');
    backupInitResponse.body.encryptedDataKey.should.not.equal('test-plaintext-key');

    // set gpg after initialization returns their gpgPubs as response
    const userGpgPub = {
      partyId: MPCv2PartiesEnum.USER,
      gpgKey: userInitResponse.body.gpgPub,
    };
    const backupGpgPub = {
      partyId: MPCv2PartiesEnum.BACKUP,
      gpgKey: backupInitResponse.body.gpgPub,
    };

    // round 1
    const userRound1Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedData: userInitResponse.body.encryptedData,
        encryptedDataKey: userInitResponse.body.encryptedDataKey,
        round: 1,
        bitgoGpgPub: bitgoGpgPub.gpgKey,
        counterPartyGpgPub: backupGpgPub.gpgKey,
      });

    const backupRound1Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'backup',
        encryptedData: backupInitResponse.body.encryptedData,
        encryptedDataKey: backupInitResponse.body.encryptedDataKey,
        round: 1,
        bitgoGpgPub: bitgoGpgPub.gpgKey,
        counterPartyGpgPub: userGpgPub.gpgKey,
      });

    // verify round 1 responses
    userRound1Response.status.should.equal(200);
    userRound1Response.body.should.have.property('encryptedData');
    userRound1Response.body.should.have.property('encryptedDataKey');
    userRound1Response.body.encryptedDataKey.should.not.equal('test-plaintext-key');
    userRound1Response.body.should.have.property('broadcastMessage');
    userRound1Response.body.should.not.have.property('p2pMessages');

    backupRound1Response.status.should.equal(200);
    backupRound1Response.body.should.have.property('encryptedData');
    backupRound1Response.body.should.have.property('encryptedDataKey');
    backupRound1Response.body.encryptedDataKey.should.not.equal('test-plaintext-key');
    backupRound1Response.body.should.have.property('broadcastMessage');
    backupRound1Response.body.should.not.have.property('p2pMessages');

    // got all round1 messages
    const userRound1Message = userRound1Response.body.broadcastMessage;
    const backupRound1Message = backupRound1Response.body.broadcastMessage;
    const bitgoRound1Message = (
      await DklsComms.encryptAndAuthOutgoingMessages(
        DklsTypes.serializeMessages({
          p2pMessages: [],
          broadcastMessages: [await bitgoSession.initDkg()],
        }),
        [userGpgPub, backupGpgPub],
        [bitgoGpgPrv],
      )
    ).broadcastMessages[0];

    // round 2
    const userRound2Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedData: userRound1Response.body.encryptedData,
        encryptedDataKey: userRound1Response.body.encryptedDataKey,
        round: 2,
        broadcastMessages: {
          bitgo: bitgoRound1Message,
          counterParty: backupRound1Message,
        },
      });

    const backupRound2Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'backup',
        encryptedData: backupRound1Response.body.encryptedData,
        encryptedDataKey: backupRound1Response.body.encryptedDataKey,
        round: 2,
        broadcastMessages: {
          bitgo: bitgoRound1Message,
          counterParty: userRound1Message,
        },
      });

    const bitgoRound2Handled = bitgoSession.handleIncomingMessages(
      DklsTypes.deserializeMessages(
        await DklsComms.decryptAndVerifyIncomingMessages(
          { p2pMessages: [], broadcastMessages: [userRound1Message, backupRound1Message] },
          [userGpgPub, backupGpgPub],
          [bitgoGpgPrv],
        ),
      ),
    );
    const bitgoRound2Response = await DklsComms.encryptAndAuthOutgoingMessages(
      DklsTypes.serializeMessages(bitgoRound2Handled),
      [userGpgPub, backupGpgPub],
      [bitgoGpgPrv],
    );

    // verify round 2 responses
    userRound2Response.status.should.equal(200);
    userRound2Response.body.should.have.property('encryptedData');
    userRound2Response.body.should.have.property('encryptedDataKey');
    userRound2Response.body.should.have.property('p2pMessages');
    userRound2Response.body.should.not.have.property('broadcastMessages');
    userRound2Response.body.p2pMessages.should.have.property('bitgo');
    userRound2Response.body.p2pMessages.should.have.property('counterParty');

    backupRound2Response.status.should.equal(200);
    backupRound2Response.body.should.have.property('encryptedData');
    backupRound2Response.body.should.have.property('encryptedDataKey');
    backupRound2Response.body.should.have.property('p2pMessages');
    backupRound2Response.body.should.not.have.property('broadcastMessages');
    backupRound2Response.body.p2pMessages.should.have.property('bitgo');
    backupRound2Response.body.p2pMessages.should.have.property('counterParty');

    // sent to bitgo to retrieve bitgo round 2 messages
    const userRound2ToBitgoMessage = userRound2Response.body.p2pMessages.bitgo;
    const userRound2ToBackupMessage = userRound2Response.body.p2pMessages.counterParty;

    const backupRound2ToBitgoMessage = backupRound2Response.body.p2pMessages.bitgo;
    const backupRound2ToUserMessage = backupRound2Response.body.p2pMessages.counterParty;

    const bitgoRound2ToUserMessage = bitgoRound2Response.p2pMessages.find(
      (msg) => msg.to === userGpgPub.partyId,
    );
    const bitgoRound2ToBackupMessage = bitgoRound2Response.p2pMessages.find(
      (msg) => msg.to === backupGpgPub.partyId,
    );

    // round 3
    const userRound3Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedData: userRound2Response.body.encryptedData,
        encryptedDataKey: userRound2Response.body.encryptedDataKey,
        round: 3,
        p2pMessages: {
          bitgo: bitgoRound2ToUserMessage,
          counterParty: backupRound2ToUserMessage,
        },
      });

    const backupRound3Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'backup',
        encryptedData: backupRound2Response.body.encryptedData,
        encryptedDataKey: backupRound2Response.body.encryptedDataKey,
        round: 3,
        p2pMessages: {
          bitgo: bitgoRound2ToBackupMessage,
          counterParty: userRound2ToBackupMessage,
        },
      });

    const bitgoRound3Handled = bitgoSession.handleIncomingMessages(
      DklsTypes.deserializeMessages(
        await DklsComms.decryptAndVerifyIncomingMessages(
          {
            p2pMessages: [userRound2ToBitgoMessage, backupRound2ToBitgoMessage],
            broadcastMessages: [],
          },
          [userGpgPub, backupGpgPub],
          [bitgoGpgPrv],
        ),
      ),
    );
    const bitgoRound3Response = await DklsComms.encryptAndAuthOutgoingMessages(
      DklsTypes.serializeMessages(bitgoRound3Handled),
      [userGpgPub, backupGpgPub],
      [bitgoGpgPrv],
    );

    // verify round 3 responses
    userRound3Response.status.should.equal(200);
    userRound3Response.body.should.have.property('encryptedData');
    userRound3Response.body.should.have.property('encryptedDataKey');
    userRound3Response.body.should.have.property('p2pMessages');
    userRound3Response.body.should.not.have.property('broadcastMessages');
    userRound3Response.body.p2pMessages.should.have.property('bitgo');
    userRound3Response.body.p2pMessages.should.have.property('counterParty');

    backupRound3Response.status.should.equal(200);
    backupRound3Response.body.should.have.property('encryptedData');
    backupRound3Response.body.should.have.property('encryptedDataKey');
    backupRound3Response.body.should.have.property('p2pMessages');
    backupRound3Response.body.should.not.have.property('broadcastMessages');
    backupRound3Response.body.p2pMessages.should.have.property('bitgo');
    backupRound3Response.body.p2pMessages.should.have.property('counterParty');

    // sent to bitgo to retrieve bitgo round 3 messages
    const userRound3ToBitgoMessage = userRound3Response.body.p2pMessages.bitgo;
    const userRound3ToBackupMessage = userRound3Response.body.p2pMessages.counterParty;

    const backupRound3ToBitgoMessage = backupRound3Response.body.p2pMessages.bitgo;
    const backupRound3ToUserMessage = backupRound3Response.body.p2pMessages.counterParty;

    const bitgoRound3ToUserMessage = bitgoRound3Response.p2pMessages.find(
      (msg) => msg.to === userGpgPub.partyId,
    );
    const bitgoRound3ToBackupMessage = bitgoRound3Response.p2pMessages.find(
      (msg) => msg.to === backupGpgPub.partyId,
    );

    // round 4
    const userRound4Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedData: userRound3Response.body.encryptedData,
        encryptedDataKey: userRound3Response.body.encryptedDataKey,
        round: 4,
        p2pMessages: {
          bitgo: bitgoRound3ToUserMessage,
          counterParty: backupRound3ToUserMessage,
        },
      });

    const backupRound4Response = await agent
      .post(`/api/${coin}/mpcv2/round`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'backup',
        encryptedData: backupRound3Response.body.encryptedData,
        encryptedDataKey: backupRound3Response.body.encryptedDataKey,
        round: 4,
        p2pMessages: {
          bitgo: bitgoRound3ToBackupMessage,
          counterParty: userRound3ToBackupMessage,
        },
      });

    const bitgoRound4Handled = bitgoSession.handleIncomingMessages(
      DklsTypes.deserializeMessages(
        await DklsComms.decryptAndVerifyIncomingMessages(
          {
            p2pMessages: [userRound3ToBitgoMessage, backupRound3ToBitgoMessage],
            broadcastMessages: [],
          },
          [userGpgPub, backupGpgPub],
          [bitgoGpgPrv],
        ),
      ),
    );
    const bitgoRound4Response = await DklsComms.encryptAndAuthOutgoingMessages(
      DklsTypes.serializeMessages(bitgoRound4Handled),
      [userGpgPub, backupGpgPub],
      [bitgoGpgPrv],
    );

    // verify round 4 responses
    userRound4Response.status.should.equal(200);
    userRound4Response.body.should.have.property('encryptedData');
    userRound4Response.body.should.have.property('encryptedDataKey');
    userRound4Response.body.should.have.property('broadcastMessage');
    userRound4Response.body.should.not.have.property('p2pMessages');

    backupRound4Response.status.should.equal(200);
    backupRound4Response.body.should.have.property('encryptedData');
    backupRound4Response.body.should.have.property('encryptedDataKey');
    backupRound4Response.body.should.have.property('broadcastMessage');
    backupRound4Response.body.should.not.have.property('p2pMessages');

    // sent to bitgo to retrieve bitgo round 4 messages
    const userRound4Message = userRound4Response.body.broadcastMessage;
    const backupRound4Message = backupRound4Response.body.broadcastMessage;
    const bitgoRound4Message = bitgoRound4Response.broadcastMessages[0];

    // finalize
    bitgoSession.handleIncomingMessages(
      DklsTypes.deserializeMessages(
        await DklsComms.decryptAndVerifyIncomingMessages(
          {
            p2pMessages: [],
            broadcastMessages: [userRound4Message, backupRound4Message],
          },
          [userGpgPub, backupGpgPub],
          [bitgoGpgPrv],
        ),
      ),
    );
    const bitgoCommonKeychain = DklsTypes.getCommonKeychain(bitgoSession.getKeyShare());

    const userFinalizeResponse = await agent
      .post(`/api/${coin}/mpcv2/finalize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        encryptedData: userRound4Response.body.encryptedData,
        encryptedDataKey: userRound4Response.body.encryptedDataKey,
        broadcastMessages: {
          bitgo: bitgoRound4Message,
          counterParty: backupRound4Message,
        },
        bitgoCommonKeychain,
      });

    const backupFinalizeResponse = await agent
      .post(`/api/${coin}/mpcv2/finalize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'backup',
        encryptedData: backupRound4Response.body.encryptedData,
        encryptedDataKey: backupRound4Response.body.encryptedDataKey,
        broadcastMessages: {
          bitgo: bitgoRound4Message,
          counterParty: userRound4Message,
        },
        bitgoCommonKeychain,
      });

    // verify finalize responses
    userFinalizeResponse.status.should.equal(200);
    userFinalizeResponse.body.should.have.property('source', 'user');
    userFinalizeResponse.body.should.have.property('commonKeychain');

    backupFinalizeResponse.status.should.equal(200);
    backupFinalizeResponse.body.should.have.property('source', 'backup');
    backupFinalizeResponse.body.should.have.property('commonKeychain');

    // check common keychains match
    userFinalizeResponse.body.commonKeychain.should.equal(
      backupFinalizeResponse.body.commonKeychain,
    );
    userFinalizeResponse.body.commonKeychain.should.equal(bitgoCommonKeychain);
  });
});
