import 'should';
import sinon from 'sinon';

import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import nock from 'nock';
import * as request from 'supertest';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { data as ethRecoveryData } from '../../mocks/ethRecoveryMusigMockData';

describe('POST /api/:coin/wallet/recovery', () => {
  let agent: request.SuperAgentTest;
  const enclavedExpressUrl = 'http://enclaved.invalid';
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
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      enclavedExpressUrl: enclavedExpressUrl,
      enclavedExpressCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      mtlsRequestCert: false,
      allowSelfSigned: true,
    };

    const app = expressApp(config);
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
    const eveRecoverWalletNock = nock(enclavedExpressUrl)
      .post(`/api/${coin}/multisig/recovery`, {
        userPub: ethRecoveryData.userKey,
        backupPub: ethRecoveryData.backupKey,
        apiKey: 'etherscan-api-token',
        unsignedSweepPrebuildTx: ethRecoveryData.unsignedSweepPrebuildTx,
        coinSpecificParams: undefined,
        walletContractAddress: ethRecoveryData.walletContractAddress,
      })
      .reply(200, {
        txHex: ethRecoveryData.txHexFullSigned,
      });

    // the call to our own master api express endpoint
    const response = await agent
      .post(`/api/${coin}/wallet/recovery`, (body) => {
        console.log('Nock received body:', body);
        return true;
      })
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub: ethRecoveryData.userKey,
        backupPub: ethRecoveryData.backupKey,
        apiKey: 'etherscan-api-token',
        walletContractAddress: ethRecoveryData.walletContractAddress,
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
        userPub: ethRecoveryData.userKey,
        backupPub: ethRecoveryData.backupKey,
        apiKey: 'etherscan-api-token',
        walletContractAddress: undefined,
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
        userPub: ethRecoveryData.userKey,
        backupPub: ethRecoveryData.backupKey,
        apiKey: 'etherscan-api-token',
        walletContractAddress: ethRecoveryData.walletContractAddress,
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
        backupPub: ethRecoveryData.backupKey,
        apiKey: 'etherscan-api-token',
        walletContractAddress: ethRecoveryData.walletContractAddress,
        recoveryDestinationAddress: undefined,
      });

    const responseNoBackupKey = await agent
      .post(`/api/${coin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub: ethRecoveryData.userKey,
        apiKey: 'etherscan-api-token',
        walletContractAddress: ethRecoveryData.walletContractAddress,
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
