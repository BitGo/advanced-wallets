import 'should';

import express from 'express';
import nock from 'nock';
import * as request from 'supertest';
import { app as enclavedApp } from '../../../enclavedApp';
import { AppMode, EnclavedConfig, TlsMode } from '../../../shared/types';

import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';

import { ebeData } from '../../mocks/ethRecoveryMusigMockData';
import unsignedSweepRecJSON from '../../mocks/unsigned-sweep-prebuild-hteth-musig-recovery.json';

describe('recoveryMultisigTransaction', () => {
  let cfg: EnclavedConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test cofig
  const kmsUrl = 'http://kms.invalid';
  const coin = 'hteth';
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

  it('should generate a successful txHex from unsigned sweep prebuild data', async () => {
    const { userPub, backupPub, walletContractAddress, userPrv, backupPrv, txHexResult } = ebeData;
    const unsignedSweepPrebuildTx = unsignedSweepRecJSON as unknown as any;

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

    const kmsNockUser = nock(kmsUrl)
      .get(`/key/${userPub}`)
      .query({ source: 'user', useLocalEncipherment: false })
      .reply(200, mockKmsUserResponse);

    const kmsNockBackup = nock(kmsUrl)
      .get(`/key/${backupPub}`)
      .query({ source: 'backup', useLocalEncipherment: false })
      .reply(200, mockKmsBackupResponse);

    console.warn(nock.activeMocks());
    console.warn(nock.isActive());

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

    kmsNockUser.done();
    kmsNockBackup.done();
  });

  it('should fail when prv keys non related to pub keys', async () => {
    const { userPub, backupPub, walletContractAddress } = ebeData;
    const unsignedSweepPrebuildTx = unsignedSweepRecJSON as unknown as any;

    // Use invalid private keys
    const invalidUserPrv = 'invalid-prv';
    const invalidBackupPrv = 'invalid-prv';

    const mockKmsUserResponse = {
      prv: invalidUserPrv,
      pub: userPub,
      source: 'user',
      type: 'independent',
    };

    const mockKmsBackupResponse = {
      prv: invalidBackupPrv,
      pub: backupPub,
      source: 'backup',
      type: 'independent',
    };

    const kmsNockUser = nock(kmsUrl)
      .get(`/key/${userPub}`)
      .query({ source: 'user', useLocalEncipherment: false })
      .reply(200, mockKmsUserResponse);

    const kmsNockBackup = nock(kmsUrl)
      .get(`/key/${backupPub}`)
      .query({ source: 'backup', useLocalEncipherment: false })
      .reply(200, mockKmsBackupResponse);

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

    kmsNockUser.done();
    kmsNockBackup.done();
  });
});
