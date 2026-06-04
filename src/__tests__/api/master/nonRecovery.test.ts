import 'should';
import * as request from 'supertest';
import nock from 'nock';
import sinon from 'sinon';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { BitGoAPITestHarness } from './testUtils';

describe('Non Recovery Tests', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const accessToken = 'test-token';
  const config: MasterExpressConfig = {
    appMode: AppMode.MASTER_EXPRESS,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    env: 'test',
    disableEnvCheck: true,
    authVersion: 2,
    advancedWalletManagerUrl: advancedWalletManagerUrl,
    awmServerCaCert: 'dummy-cert',
    tlsMode: TlsMode.DISABLED,
    httpLoggerFile: '',
    clientCertAllowSelfSigned: true,
    recoveryMode: false,
  };

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    BitGoAPITestHarness.clearConstantsCache();
  });

  describe('Recovery', () => {
    it('should fail to run mbe recovery if not in recovery mode', async () => {
      const coin = 'tbtc';
      const userPub = 'xpub_user';
      const backupPub = 'xpub_backup';
      const bitgoPub = 'xpub_bitgo';
      const recoveryDestination = 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu';
      const response = await agent
        .post(`/api/v1/${coin}/advancedwallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multiSigRecoveryParams: {
            userPub,
            backupPub,
            bitgoPub,
            walletContractAddress: '',
          },
          recoveryDestinationAddress: recoveryDestination,
          coin,
          apiKey: 'key',
          coinSpecificParams: {
            evmRecoveryOptions: {
              gasPrice: 20000000000,
              gasLimit: 500000,
            },
          },
        });
      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'Recovery operations are not enabled. The server must be in recovery mode to perform this action.',
      );
    });
  });

  describe('Recovery Consolidation', () => {
    it('should fail to run mbe recovery consolidation if not in recovery mode', async () => {
      const response = await agent
        .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'onchain',
          userPub: 'user-xpub',
          backupPub: 'backup-xpub',
          bitgoPub: 'bitgo-xpub',
          tokenContractAddress: 'tron-token',
          startingScanIndex: 1,
          endingScanIndex: 3,
        });

      response.status.should.equal(500);
    });
  });
});
