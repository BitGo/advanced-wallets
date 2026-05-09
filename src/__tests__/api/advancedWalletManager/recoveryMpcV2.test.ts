import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../initConfig';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';

import express from 'express';
import nock from 'nock';
import 'should';
import * as request from 'supertest';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import { DklsTypes, DklsUtils } from '@bitgo-beta/sdk-lib-mpc';

describe('recoveryMpcV2', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test config
  const keyProviderUrl = 'http://key-provider.invalid';
  const ethLikeCoin = 'hteth';
  const cosmosLikeCoin = 'tsei';
  const accessToken = 'test-token';

  // sinon sandbox
  const sandbox = sinon.createSandbox();
  let configStub: sinon.SinonStub;

  // key provider nocks setup
  let userKeyShare: string;
  let backupKeyShare: string;
  let commonKeychain: string;
  let mockKeyProviderUserResponse: { prv: string; pub: string; source: string; type: string };
  let mockKeyProviderBackupResponse: { prv: string; pub: string; source: string; type: string };
  let input: { txHex: string; pub: string };

  before(async () => {
    const [userShare, backupShare] = await DklsUtils.generateDKGKeyShares();
    userKeyShare = userShare.getKeyShare().toString('base64');
    backupKeyShare = backupShare.getKeyShare().toString('base64');
    commonKeychain = DklsTypes.getCommonKeychain(userShare.getKeyShare());

    mockKeyProviderUserResponse = {
      prv: JSON.stringify(userKeyShare),
      pub: commonKeychain,
      source: 'user',
      type: 'tss',
    };

    mockKeyProviderBackupResponse = {
      prv: JSON.stringify(backupKeyShare),
      pub: commonKeychain,
      source: 'backup',
      type: 'tss',
    };

    input = {
      txHex:
        '02f6824268018502540be4008504a817c80083030d409443442e403d64d29c4f64065d0c1a0e8edc03d6c88801550f7dca700000823078c0',
      pub: commonKeychain,
    };

    // nock config
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      keyProviderUrl: keyProviderUrl,
      httpLoggerFile: '',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      recoveryMode: true,
    };

    configStub = sandbox.stub(configModule, 'initConfig').returns(cfg);

    // app setup
    app = advancedWalletManagerApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    sandbox.restore();
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

  it('should route backup key retrieval to backup KMS when configured', async () => {
    const kmsUrl = 'http://kms.invalid';
    const backupKmsUrl = 'http://backup-kms.invalid';

    const mockKmsUserResponse = {
      prv: JSON.stringify(userKeyShare),
      pub: commonKeychain,
      source: 'user',
      type: 'tss',
    };

    const mockKmsBackupResponse = {
      prv: JSON.stringify(backupKeyShare),
      pub: commonKeychain,
      source: 'backup',
      type: 'tss',
    };

    // Reconfigure app with backup KMS URL
    const dualCfg: AdvancedWalletManagerConfig = {
      ...cfg,
      keyProviderUrl: kmsUrl,
      backupKmsUrl,
    };
    configStub.returns(dualCfg);
    const dualApp = advancedWalletManagerApp(dualCfg);
    const dualAgent = request.agent(dualApp);

    // User key served from primary KMS
    const userKmsNock = nock(kmsUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKmsUserResponse)
      .persist();

    // Backup key served from backup KMS
    const backupKmsNock = nock(backupKmsUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'backup' })
      .reply(200, mockKmsBackupResponse)
      .persist();

    const response = await dualAgent
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    response.status.should.equal(200);
    response.body.should.have.property('txHex');
    response.body.should.have.property('stringifiedSignature');

    userKmsNock.isDone().should.be.true();
    backupKmsNock.isDone().should.be.true();
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
