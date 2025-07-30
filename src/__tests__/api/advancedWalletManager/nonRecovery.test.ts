import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../shared/types';
import sinon from 'sinon';
import * as middleware from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import { BitGoAPI as BitGo } from '@bitgo-beta/sdk-api';

describe('Non Recovery', () => {
  let agent: request.SuperAgentTest;
  const coin = 'tbtc';
  const config: AdvancedWalletManagerConfig = {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    tlsMode: TlsMode.DISABLED,
    httpLoggerFile: '',
    allowSelfSigned: true,
    kmsUrl: 'kms.example.com',
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // Initialize BitGo with test environment
    const bitgo = new BitGo({
      env: 'test',
      accessToken: 'test_token',
    });

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<AdvancedWalletManagerConfig>).bitgo = bitgo;
      (req as BitGoRequest<AdvancedWalletManagerConfig>).config = config;
      next();
    });

    // Create app after middleware is stubbed
    const app = advancedWalletManagerApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should fail to run awm recovery if not in recovery mode', async () => {
    const userPub = 'xpub_user';
    const backupPub = 'xpub_backup';
    const bitgoPub = 'xpub_bitgo';

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: {},
      walletContractAddress: '',
      coin,
    });
    response.status.should.equal(500);
    response.body.should.have.property('error');
    response.body.should.have.property('details');
    response.body.details.should.containEql(
      'Recovery operations are not enabled. The server must be in recovery mode to perform this action.',
    );
  });
});
