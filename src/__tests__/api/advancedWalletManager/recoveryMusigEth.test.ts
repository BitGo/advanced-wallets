import 'should';

import express from 'express';
import nock from 'nock';
import * as request from 'supertest';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../shared/types';

import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';

import { awmData } from '../../mocks/ethRecoveryMusigMockData';
import unsignedSweepRecJSON from '../../mocks/unsigned-sweep-prebuild-hteth-musig-recovery.json';

describe('recoveryMultisigTransaction', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test cofig
  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'hteth';
  const accessToken = 'test-token';

  // sinon sandbox
  const sandbox = sinon.createSandbox();
  let configStub: sinon.SinonStub;

  before(() => {
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
      httpLoggerFile: '',
      keyProviderUrl: keyProviderUrl,
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

  it('should generate a successful txHex from unsigned sweep prebuild data', async () => {
    const { userPub, backupPub, walletContractAddress, userPrv, backupPrv, txHexResult } = awmData;
    const unsignedSweepPrebuildTx = unsignedSweepRecJSON as unknown as any;

    const mockKeyProviderUserResponse = {
      prv: userPrv,
      pub: userPub,
      source: 'user',
      type: 'independent',
    };

    const mockKeyProviderBackupResponse = {
      prv: backupPrv,
      pub: backupPub,
      source: 'backup',
      type: 'independent',
    };

    const keyProviderNockUser = nock(keyProviderUrl)
      .get(`/key/${userPub}`)
      .query({ source: 'user' })
      .reply(200, mockKeyProviderUserResponse);

    const keyProviderNockBackup = nock(keyProviderUrl)
      .get(`/key/${backupPub}`)
      .query({ source: 'backup' })
      .reply(200, mockKeyProviderBackupResponse);

    const response = await agent
      .post(`/api/${coin}/multisig/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub,
        backupPub,
        apiKey: 'etherscan-api-token',
        unsignedSweepPrebuildTx,
        walletContractAddress,
        coinSpecificParams: undefined,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', txHexResult);

    keyProviderNockUser.done();
    keyProviderNockBackup.done();
  });

  it('should route backup key retrieval to backup KMS when configured', async () => {
    const kmsUrl = 'http://kms.invalid';
    const backupKmsUrl = 'http://backup-kms.invalid';
    const { userPub, backupPub, walletContractAddress, userPrv, backupPrv, txHexResult } = awmData;
    const unsignedSweepPrebuildTx = unsignedSweepRecJSON as unknown as any;

    // Reconfigure app with backup KMS URL
    const dualCfg: AdvancedWalletManagerConfig = {
      ...cfg,
      keyProviderUrl: kmsUrl,
      backupKmsUrl,
    };
    configStub.returns(dualCfg);
    const dualApp = advancedWalletManagerApp(dualCfg);
    const dualAgent = request.agent(dualApp);

    const mockKmsUserResponse = {
      prv: userPrv,
      pub: userPub,
      source: 'user',
      type: 'independent',
    };

    const mockKmsBackupResponse = {
      prv: backupPrv,
      pub: backupPub,
      source: 'backup',
      type: 'independent',
    };

    // User key from primary KMS
    const kmsNockUser = nock(kmsUrl)
      .get(`/key/${userPub}`)
      .query({ source: 'user' })
      .reply(200, mockKmsUserResponse);

    // Backup key from backup KMS
    const kmsNockBackup = nock(backupKmsUrl)
      .get(`/key/${backupPub}`)
      .query({ source: 'backup' })
      .reply(200, mockKmsBackupResponse);

    const response = await dualAgent
      .post(`/api/${coin}/multisig/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub,
        backupPub,
        apiKey: 'etherscan-api-token',
        unsignedSweepPrebuildTx,
        walletContractAddress,
        coinSpecificParams: undefined,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', txHexResult);

    kmsNockUser.done();
    kmsNockBackup.done();
  });

  it('should fail when prv keys non related to pub keys', async () => {
    const { userPub, backupPub, walletContractAddress } = awmData;
    const unsignedSweepPrebuildTx = unsignedSweepRecJSON as unknown as any;

    // Use invalid private keys
    const invalidUserPrv = 'invalid-prv';
    const invalidBackupPrv = 'invalid-prv';

    const mockKeyProviderUserResponse = {
      prv: invalidUserPrv,
      pub: userPub,
      source: 'user',
      type: 'independent',
    };

    const mockKeyProviderBackupResponse = {
      prv: invalidBackupPrv,
      pub: backupPub,
      source: 'backup',
      type: 'independent',
    };

    const keyProviderNockUser = nock(keyProviderUrl)
      .get(`/key/${userPub}`)
      .query({ source: 'user' })
      .reply(200, mockKeyProviderUserResponse);

    const keyProviderNockBackup = nock(keyProviderUrl)
      .get(`/key/${backupPub}`)
      .query({ source: 'backup' })
      .reply(200, mockKeyProviderBackupResponse);

    const response = await agent
      .post(`/api/${coin}/multisig/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub,
        backupPub,
        apiKey: 'etherscan-api-token',
        unsignedSweepPrebuildTx,
        walletContractAddress,
        coinSpecificParams: undefined,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');

    keyProviderNockUser.done();
    keyProviderNockBackup.done();
  });
});
