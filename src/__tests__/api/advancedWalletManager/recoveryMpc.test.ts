import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../initConfig';
import { app as expressApp } from '../../../advancedWalletManagerApp';

import express from 'express';
import nock from 'nock';
import 'should';
import * as request from 'supertest';
import { DklsTypes, DklsUtils } from '@bitgo-beta/sdk-lib-mpc';

describe('recoveryMpc', async () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test config
  const kmsUrl = 'http://kms.invalid';
  const eddsaCoin = 'tsol';
  const nonSol = 'tnear';
  const accessToken = 'test-token';

  // sinon stubs
  // let configStub: sinon.SinonStub;

  // kms nocks setup
  const [userShare, backupShare] = await DklsUtils.generateDKGKeyShares();
  const userKeyShare = userShare.getKeyShare().toString('base64');
  const backupKeyShare = backupShare.getKeyShare().toString('base64');
  const commonKeychain = DklsTypes.getCommonKeychain(userShare.getKeyShare());

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
  const input = {
    txHex:
      '',
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
      kmsUrl: kmsUrl,
      httpLoggerFile: '',
      tlsMode: TlsMode.DISABLED,
      allowSelfSigned: true,
      recoveryMode: true,
    };

    // app setup
    app = expressApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // happy path test
  it('should be sign a MPC Recovery', async () => {
    // nocks for KMS responses
    const userKmsNock = nock(kmsUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user', useLocalEncipherment: false })
      .reply(200, mockKmsUserResponse)
      .persist();
    const backupKmsNock = nock(kmsUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'backup', useLocalEncipherment: false })
      .reply(200, mockKmsBackupResponse)
      .persist();

    const eddsaSignatureResponse = await agent
      .post(`/api/${eddsaCoin}/mpc/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    eddsaSignatureResponse.status.should.equal(200);
    eddsaSignatureResponse.body.should.have.property('txHex');
    eddsaSignatureResponse.body.txHex.should.equal(input.txHex);
  });
});
