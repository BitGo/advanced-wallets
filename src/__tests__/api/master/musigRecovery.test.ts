import 'should';
import sinon from 'sinon';

import { AbstractEthLikeNewCoins } from '@bitgo-beta/abstract-eth';
import nock from 'nock';
import * as request from 'supertest';
import { app as advancedWalletManagerApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { data as ethRecoveryData } from '../../mocks/ethRecoveryMusigMockData';

describe('POST /api/:coin/wallet/recovery', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advanced-wallet-manager.invalid';
  const coin = 'hteth';
  const accessToken = 'test-token';

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: advancedWalletManagerUrl,
      advancedWalletManagerCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      allowSelfSigned: true,
      recoveryMode: true,
    };

    const app = advancedWalletManagerApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should get the tx hex for broadcasting from eve on musig recovery ', async () => {
    // sdk call mock on mbe
    const recoverStub = sinon
      .stub(AbstractEthLikeNewCoins.prototype, 'recover')
      .resolves(ethRecoveryData.unsignedSweepPrebuildTx);

    // the call to eve.recoverWallet(...)
    // that contains the calls to sdk.signTransaction
    const eveRecoverWalletNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/recovery`, {
        userPub: ethRecoveryData.userKey,
        backupPub: ethRecoveryData.backupKey,
        unsignedSweepPrebuildTx: ethRecoveryData.unsignedSweepPrebuildTx,
        coinSpecificParams: undefined,
        walletContractAddress: ethRecoveryData.walletContractAddress,
      })
      .reply(200, {
        txHex: ethRecoveryData.txHexFullSigned,
      });

    // the call to our own master api express endpoint
    const response = await agent
      .post(`/api/${coin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multiSigRecoveryParams: {
          userPub: ethRecoveryData.userKey,
          backupPub: ethRecoveryData.backupKey,
          walletContractAddress: ethRecoveryData.walletContractAddress,
          bitgoPub: '',
        },
        apiKey: 'etherscan-api-token',
        recoveryDestinationAddress: ethRecoveryData.recoveryDestinationAddress,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', ethRecoveryData.txHexFullSigned);
    sinon.assert.calledOnce(recoverStub);
    eveRecoverWalletNock.done();
  });

  it('should fail when walletContractAddress (origin) not provided', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multiSigRecoveryParams: {
          userPub: ethRecoveryData.userKey,
          backupPub: ethRecoveryData.backupKey,
          walletContractAddress: undefined,
          bitgoPub: undefined,
        },
        apiKey: 'etherscan-api-token',
        recoveryDestinationAddress: ethRecoveryData.recoveryDestinationAddress,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.match(/walletContractAddress/i);
  });
  it('should fail when recoveryDestinationAddress (destiny) not provided', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multiSigRecoveryParams: {
          userPub: ethRecoveryData.userKey,
          backupPub: ethRecoveryData.backupKey,
          walletContractAddress: ethRecoveryData.walletContractAddress,
          bitgoPub: undefined,
        },
        recoveryDestinationAddress: undefined,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
    response.body.error.should.match(/recoveryDestinationAddress/i);
  });
  it('should fail when userPub or backupPub not provided', async () => {
    const responseNoUserKey = await agent
      .post(`/api/${coin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multiSigRecoveryParams: {
          backupPub: ethRecoveryData.backupKey,
          walletContractAddress: ethRecoveryData.walletContractAddress,
          bitgoPub: undefined,
        },
        recoveryDestinationAddress: undefined,
      });

    const responseNoBackupKey = await agent
      .post(`/api/${coin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multiSigRecoveryParams: {
          userPub: ethRecoveryData.userKey,
          walletContractAddress: ethRecoveryData.walletContractAddress,
          bitgoPub: undefined,
        },
        apiKey: 'etherscan-api-token',
        recoveryDestinationAddress: undefined,
      });

    responseNoUserKey.status.should.equal(400);
    responseNoUserKey.body.should.have.property('error');
    responseNoUserKey.body.error.should.match(/userPub/i);

    responseNoBackupKey.status.should.equal(400);
    responseNoBackupKey.body.should.have.property('error');
    responseNoBackupKey.body.error.should.match(/backupPub/i);
  });
});
