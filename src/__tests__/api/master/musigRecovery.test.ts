import 'should';
import sinon from 'sinon';

import nock from 'nock';
import * as request from 'supertest';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { data as ethRecoveryData } from '../../mocks/ethRecoveryMusigMockData';
import { BitGoAPITestHarness, DEFAULT_ASYNC_MODE_CONFIG } from './testUtils';

describe('POST /api/v1/:coin/advancedwallet/recovery', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
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
      awmServerCaCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      recoveryMode: true,
      asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG,
    };

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    BitGoAPITestHarness.clearConstantsCache();
  });

  it('should get the tx hex for broadcasting from eve on musig recovery ', async () => {
    const backupKeyAddress = '0x30edc88a77598833f58947638b2ac3d5713d9845';
    const apiKey = 'etherscan-api-token';
    const etherscanBase = 'https://api.etherscan.io';
    const chainid = '560048';

    // Etherscan calls to get the nonce, balance, and sequence ID for the backup key and wallet contract
    const txlistNock = nock(etherscanBase)
      .get(
        `/v2/api?chainid=${chainid}&module=account&action=txlist&address=${backupKeyAddress}&apikey=${apiKey}`,
      )
      .twice()
      .reply(200, { result: [] });

    const backupBalanceNock = nock(etherscanBase)
      .get(
        `/v2/api?chainid=${chainid}&module=account&action=balance&address=${backupKeyAddress}&apikey=${apiKey}`,
      )
      .reply(200, { result: '10000000000000000' });

    const walletBalanceNock = nock(etherscanBase)
      .get(
        `/v2/api?chainid=${chainid}&module=account&action=balance&address=${ethRecoveryData.walletContractAddress}&apikey=${apiKey}`,
      )
      .reply(200, { result: '1000000000000000000' });

    const sequenceIdNock = nock(etherscanBase)
      .get(
        `/v2/api?chainid=${chainid}&module=proxy&action=eth_call&to=${ethRecoveryData.walletContractAddress}&data=a0b7967b&tag=latest&apikey=${apiKey}`,
      )
      .reply(200, {
        result: '0x0000000000000000000000000000000000000000000000000000000000000001',
      });

    const eveRecoverWalletNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/recovery`, (body) => {
        return (
          body.userPub === ethRecoveryData.userKey &&
          body.backupPub === ethRecoveryData.backupKey &&
          body.walletContractAddress === ethRecoveryData.walletContractAddress &&
          body.unsignedSweepPrebuildTx !== undefined
        );
      })
      .reply(200, {
        txHex: ethRecoveryData.txHexFullSigned,
      });

    // the call to our own master api express endpoint
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multiSigRecoveryParams: {
          userPub: ethRecoveryData.userKey,
          backupPub: ethRecoveryData.backupKey,
          walletContractAddress: ethRecoveryData.walletContractAddress,
          bitgoPub: '',
        },
        apiKey,
        recoveryDestinationAddress: ethRecoveryData.recoveryDestinationAddress,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', ethRecoveryData.txHexFullSigned);
    txlistNock.isDone().should.be.true();
    backupBalanceNock.isDone().should.be.true();
    walletBalanceNock.isDone().should.be.true();
    sequenceIdNock.isDone().should.be.true();
    eveRecoverWalletNock.done();
  });

  it('should fail when walletContractAddress (origin) not provided', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/recovery`)
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
      .post(`/api/v1/${coin}/advancedwallet/recovery`)
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
      .post(`/api/v1/${coin}/advancedwallet/recovery`)
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
      .post(`/api/v1/${coin}/advancedwallet/recovery`)
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
