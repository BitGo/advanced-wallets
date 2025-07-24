import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import sinon from 'sinon';
import * as middleware from '../../../shared/middleware';
import * as masterMiddleware from '../../../api/master/middleware/middleware';
import { BitGoRequest } from '../../../types/request';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { EnclavedExpressClient } from '../../../api/master/clients/enclavedExpressClient';

describe('Non Recovery Tests', () => {
  let agent: request.SuperAgentTest;
  let mockBitgo: BitGoAPI;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const accessToken = 'test-token';
  const config: MasterExpressConfig = {
    appMode: AppMode.MASTER_EXPRESS,
    port: 0,
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
    recoveryMode: false,
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // Create mock BitGo instance with base functionality
    mockBitgo = {
      coin: sinon.stub(),
      _coinFactory: {},
      _useAms: false,
      initCoinFactory: sinon.stub(),
      registerToken: sinon.stub(),
      getValidate: sinon.stub(),
      validateAddress: sinon.stub(),
      verifyAddress: sinon.stub(),
      verifyPassword: sinon.stub(),
      encrypt: sinon.stub(),
      decrypt: sinon.stub(),
      lock: sinon.stub(),
      unlock: sinon.stub(),
      getSharingKey: sinon.stub(),
      ping: sinon.stub(),
      authenticate: sinon.stub(),
      authenticateWithAccessToken: sinon.stub(),
      logout: sinon.stub(),
      me: sinon.stub(),
      session: sinon.stub(),
      getUser: sinon.stub(),
      users: sinon.stub(),
      getWallet: sinon.stub(),
      getWallets: sinon.stub(),
      addWallet: sinon.stub(),
      removeWallet: sinon.stub(),
      getAsUser: sinon.stub(),
      register: sinon.stub(),
    } as unknown as BitGoAPI;

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).bitgo = mockBitgo;
      (req as BitGoRequest<MasterExpressConfig>).config = config;
      next();
    });

    // Create app after middleware is stubbed
    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  describe('Recovery', () => {
    const coin = 'tbtc';

    beforeEach(() => {
      sinon.stub(masterMiddleware, 'validateMasterExpressConfig').callsFake((req, res, next) => {
        (req as BitGoRequest<MasterExpressConfig>).params = { coin };
        (req as BitGoRequest<MasterExpressConfig>).enclavedExpressClient =
          new EnclavedExpressClient(config, coin);
        next();
        return undefined;
      });
    });

    it('should fail to run recovery if not in recovery mode', async () => {
      const coin = 'tbtc';
      const userPub = 'xpub_user';
      const backupPub = 'xpub_backup';
      const bitgoPub = 'xpub_bitgo';
      const recoveryDestination = 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu';
      const response = await agent
        .post(`/api/${coin}/wallet/recovery`)
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
    it('should fail to run recovery consolidation if not in recovery mode', async () => {
      const response = await agent
        .post(`/api/trx/wallet/recoveryconsolidations`)
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
