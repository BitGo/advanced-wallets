import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../initConfig';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';

import express from 'express';
import nock from 'nock';
import 'should';
import * as request from 'supertest';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import { DklsTypes, DklsUtils } from '@bitgo-beta/sdk-lib-mpc';

describe('recoveryMpcV2', async () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test config
  const keyProviderUrl = 'http://key-provider.invalid';
  const ethLikeCoin = 'hteth';
  const cosmosLikeCoin = 'tsei';
  const accessToken = 'test-token';

  // sinon stubs
  let configStub: sinon.SinonStub;

  // key provider nocks setup
  const [userShare, backupShare] = await DklsUtils.generateDKGKeyShares();
  const userKeyShare = userShare.getKeyShare().toString('base64');
  const backupKeyShare = backupShare.getKeyShare().toString('base64');
  const commonKeychain = DklsTypes.getCommonKeychain(userShare.getKeyShare());

  const mockKeyProviderUserResponse = {
    prv: JSON.stringify(userKeyShare),
    pub: commonKeychain,
    source: 'user',
    type: 'tss',
  };

  const mockKeyProviderBackupResponse = {
    prv: JSON.stringify(backupKeyShare),
    pub: commonKeychain,
    source: 'backup',
    type: 'tss',
  };
  const input = {
    txHex:
      '02f6824268018502540be4008504a817c80083030d409443442e403d64d29c4f64065d0c1a0e8edc03d6c88801550f7dca700000823078c0',
    pub: commonKeychain,
  };

  before(async () => {
    // nock config
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      keyProviderUrl: keyProviderUrl,
      httpLoggerFile: '',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      recoveryMode: true,
    };

    configStub = sinon.stub(configModule, 'initConfig').returns(cfg);

    // app setup
    app = advancedWalletManagerApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    configStub.restore();
  });

  // happy path test
  it('should be sign a Mpc V2 Recovery', async () => {
    // nocks for key provider responses
    const userKeyProviderNock = nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKeyProviderUserResponse)
      .persist();
    const backupKeyProviderNock = nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'backup' })
      .reply(200, mockKeyProviderBackupResponse)
      .persist();

    const ethLikeSignatureResponse = await agent
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    ethLikeSignatureResponse.status.should.equal(200);
    ethLikeSignatureResponse.body.should.have.property('txHex');
    ethLikeSignatureResponse.body.txHex.should.equal(input.txHex);

    ethLikeSignatureResponse.body.should.have.property('stringifiedSignature');
    const ethLikeSignature = JSON.parse(ethLikeSignatureResponse.body.stringifiedSignature);
    ethLikeSignature.should.have.property('recid');
    ethLikeSignature.should.have.property('r');
    ethLikeSignature.should.have.property('s');
    ethLikeSignature.should.have.property('y');

    const cosmosLikeSignatureResponse = await agent
      .post(`/api/${cosmosLikeCoin}/mpcv2/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    cosmosLikeSignatureResponse.status.should.equal(200);
    cosmosLikeSignatureResponse.body.should.have.property('txHex');
    cosmosLikeSignatureResponse.body.txHex.should.equal(input.txHex);

    cosmosLikeSignatureResponse.body.should.have.property('stringifiedSignature');
    const cosmosLikeSignature = JSON.parse(cosmosLikeSignatureResponse.body.stringifiedSignature);
    cosmosLikeSignature.should.have.property('recid');
    cosmosLikeSignature.should.have.property('r');
    cosmosLikeSignature.should.have.property('s');
    cosmosLikeSignature.should.have.property('y');

    userKeyProviderNock.isDone().should.be.true();
    backupKeyProviderNock.isDone().should.be.true();
  });

  // failure test case
  it('should throw 400 Bad Request if failed to construct eth transaction from message hex', async () => {
    const input = {
      txHex: 'invalid-hex',
      pub: commonKeychain,
    };

    // nocks for key provider responses
    nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKeyProviderUserResponse);
    nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'backup' })
      .reply(200, mockKeyProviderBackupResponse);

    const signatureResponse = await agent
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    signatureResponse.status.should.equal(400);
    signatureResponse.body.should.have.property('error');
    signatureResponse.body.error.should.equal('BadRequestError');
    signatureResponse.body.should.have.property('details');
    signatureResponse.body.details.should.startWith(
      'Failed to construct eth transaction from message hex',
    );
  });
});
