import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import sinon from 'sinon';
import * as middleware from '../../../shared/middleware';
import * as masterMiddleware from '../../../api/master/middleware/middleware';
import { BitGoRequest } from '../../../types/request';
import { BitGo } from 'bitgo';
import { EnclavedExpressClient } from '../../../api/master/clients/enclavedExpressClient';
import { CoinFamily } from '@bitgo/statics';

describe('utxo recovery', () => {
  let agent: request.SuperAgentTest;
  let mockBitgo: BitGo;
  let mockRecover: sinon.SinonStub;
  let mockIsValidPub: sinon.SinonStub;
  let coinStub: sinon.SinonStub;
  let mockRecoverResponse: any;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const coin = 'tbtc';
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
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // Setup mock response
    mockRecoverResponse = {
      txHex:
        '0100000001edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f417027900000000',
      txInfo: {
        unspents: [
          {
            id: '3bc8f46fcbbc04e4b4a61f1a67a2cca381254524ca6d5e26bfaaf5fe83a5d7ed:0',
            address: 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu',
            value: 4000,
            chain: 20,
            index: 0,
            valueString: '4000',
          },
        ],
      },
      feeInfo: {},
      coin: 'tbtc',
    };

    // Create mock methods
    mockRecover = sinon.stub().resolves(mockRecoverResponse);
    mockIsValidPub = sinon.stub().returns(true);
    const mockCoin = {
      recover: mockRecover,
      isValidPub: mockIsValidPub,
      getFamily: sinon.stub().returns(CoinFamily.BTC),
    };
    coinStub = sinon.stub().returns(mockCoin);

    // Create mock BitGo instance
    mockBitgo = {
      coin: coinStub,
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
    } as unknown as BitGo;

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).bitgo = mockBitgo;
      (req as BitGoRequest<MasterExpressConfig>).config = config;
      next();
    });

    sinon.stub(masterMiddleware, 'validateMasterExpressConfig').callsFake((req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).params = { coin };
      (req as BitGoRequest<MasterExpressConfig>).enclavedExpressClient = new EnclavedExpressClient(
        config,
        coin,
      );
      next();
      return undefined;
    });

    // Create app after middleware is stubbed
    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should recover a UTXO wallet by calling the enclaved express service', async () => {
    const userPub = 'xpub_user';
    const backupPub = 'xpub_backup';
    const bitgoPub = 'xpub_bitgo';
    const recoveryDestination = 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu';

    // Mock the enclaved express recovery call
    const recoveryNock = nock(enclavedExpressUrl)
      .post(`/api/${coin}/multisig/recovery`, {
        userPub,
        backupPub,
        bitgoPub,
        unsignedSweepPrebuildTx: mockRecoverResponse,
        walletContractAddress: '',
      })
      .reply(200, {
        txHex:
          '01000000000101edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f41702790400473044022043a9256810ef47ce36a092305c0b1ef675bce53e46418eea8cacbf1643e541d90220450766e048b841dac658d0a2ba992628bfe131dff078c3a574cadf67b4946647014730440220360045a15e459ed44aa3e52b86dd6a16dddaf319821f4dcc15627686f377edd102205cb3d5feab1a773c518d43422801e01dd1bc586bb09f6a9ed23a1fc0cfeeb5310169522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae00000000',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub,
        backupPub,
        bitgoPub,
        recoveryDestinationAddress: recoveryDestination,
        walletContractAddress: '',
        coin,
        apiKey: 'key',
        coinSpecificParams: {
          addressScan: 1,
        },
      });

    response.status.should.equal(200);
    response.body.should.have.property('txHex');
    response.body.txHex.should.equal(
      '01000000000101edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f41702790400473044022043a9256810ef47ce36a092305c0b1ef675bce53e46418eea8cacbf1643e541d90220450766e048b841dac658d0a2ba992628bfe131dff078c3a574cadf67b4946647014730440220360045a15e459ed44aa3e52b86dd6a16dddaf319821f4dcc15627686f377edd102205cb3d5feab1a773c518d43422801e01dd1bc586bb09f6a9ed23a1fc0cfeeb5310169522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae00000000',
    );

    // Verify SDK coin method calls
    coinStub.calledWith(coin).should.be.true();
    mockIsValidPub.calledWith(userPub).should.be.true();
    mockIsValidPub.calledWith(backupPub).should.be.true();
    mockRecover
      .calledWith({
        userKey: userPub,
        backupKey: backupPub,
        bitgoKey: bitgoPub,
        recoveryDestination: recoveryDestination,
        apiKey: 'key',
        ignoreAddressTypes: [],
        scan: 1,
        feeRate: undefined,
      })
      .should.be.true();

    // Verify enclaved express call
    recoveryNock.done();
  });
});
