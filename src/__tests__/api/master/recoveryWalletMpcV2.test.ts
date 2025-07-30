import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import sinon from 'sinon';
import * as middleware from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import { BitGoAPI } from '@bitgo-beta/sdk-api';

describe('MBE mpcv2 recovery', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advanced-wallet-manager.invalid';
  const ethLikeCoin = 'hteth';
  const cosmosLikeCoin = 'tsei';
  const accessToken = 'test-token';

  let bitgo: BitGoAPI;

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // Create a BitGo instance that we'll use for stubbing
    bitgo = new BitGoAPI({ env: 'test' });

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

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).bitgo = bitgo;
      (req as BitGoRequest<MasterExpressConfig>).config = config;
      next();
    });

    const app = advancedWalletManagerApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should recover a HETH (an eth-like) wallet by calling the advanced wallet manager service', async () => {
    const etherscanTxlistNock = nock('https://api.etherscan.io')
      .get(
        `/v2/api?chainid=17000&module=account&action=txlist&address=0x43442e403d64d29c4f64065d0c1a0e8edc03d6c8&apikey=etherscan-api-key`,
      )
      .matchHeader('any', () => true)
      .reply(200, {
        result: [
          {
            from: '0x43442e403d64d29c4f64065d0c1a0e8edc03d6c8',
          },
        ],
      });

    const etherscanBalanceNock = nock('https://api.etherscan.io')
      .get(
        `/v2/api?chainid=17000&module=account&action=balance&address=0x43442e403d64d29c4f64065d0c1a0e8edc03d6c8&apikey=etherscan-api-key`,
      )
      .matchHeader('any', () => true)
      .reply(200, {
        result: '100000000000000000', // 1 ETH in wei
      });

    const advancedWalletManagerNock = nock(advancedWalletManagerUrl)
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .reply(200, {
        txHex:
          '02f6824268018502540be4008504a817c80083030d409443442e403d64d29c4f64065d0c1a0e8edc03d6c88801550f7dca700000823078c0',
        stringifiedSignature: JSON.stringify({
          recid: 0,
          r: '469cf5d0a96e2da990afbe3807ec020a11cc0f9e418d4349ed5c8e64c09bac1e',
          s: '7b07a8fc108a351d926e71317462c220f59e732e59636ee0070796d57deb3bf0',
          y: '02e6366ae1310aee43334323d33ba1d7b363c044018c62793ee79402afe675aaf3',
        }),
      });

    const response = await agent
      .post(`/api/${ethLikeCoin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        isTssRecovery: true,
        tssRecoveryParams: {
          commonKeychain:
            '03ee2aa7a0951e0ddf5568c9e0008a824b46324900fa50bd62f43dd75705924d1c4dea9e1138b0fd34b77fa5ead28f24d8dcd053b48144915514ef32941f823075',
        },
        recoveryDestinationAddress: '0x43442e403d64d29c4f64065d0c1a0e8edc03d6c8',
        coinSpecificParams: {
          ecdsaEthLikeRecoverySpecificParams: {
            walletContractAddress: '0x43442e403d64d29c4f64065d0c1a0e8edc03d6c8',
            bitgoDestinationAddress: '0x43442e403d64d29c4f64065d0c1a0e8edc03d6c8', //placeholder
            apiKey: `etherscan-api-key`,
          },
        },
      });

    response.status.should.equal(200);
    response.body.should.have.property('txHex');

    etherscanTxlistNock.isDone().should.be.true();
    etherscanBalanceNock.isDone().should.be.true();
    advancedWalletManagerNock.isDone().should.be.true();
  });

  it('should recover a SEI (a cosmos-like) wallet by calling the advanced wallet manager service', async () => {
    const seiChainIdNock = nock('https://rest.atlantic-2.seinetwork.io')
      .get(`/cosmos/base/tendermint/v1beta1/blocks/latest`)
      .matchHeader('any', () => true)
      .reply(200, {
        block: {
          header: {
            chain_id: 'atlantic-2', // sei testnet chain ID
          },
        },
      });

    const seiAccountDetailsNock = nock('https://rest.atlantic-2.seinetwork.io')
      .get(`/cosmos/auth/v1beta1/accounts/sei133wud20f6vpaz0r2m653g8h9tgnppr0378ped5`)
      .matchHeader('any', () => true)
      .reply(200, {
        account: {
          account_number: '8459889',
          sequence: '1',
        },
      });

    const seiBalanceNock = nock('https://rest.atlantic-2.seinetwork.io')
      .get(`/cosmos/bank/v1beta1/balances/sei133wud20f6vpaz0r2m653g8h9tgnppr0378ped5`)
      .matchHeader('any', () => true)
      .reply(200, {
        balances: [{ denom: 'usei', amount: '4980000' }],
      });

    const advancedWalletManagerNock = nock(advancedWalletManagerUrl)
      .post(`/api/${cosmosLikeCoin}/mpcv2/recovery`)
      .reply(200, {
        txHex:
          '0a8c010a89010a1c2f636f736d6f732e62616e6b2e763162657461312e4d736753656e6412690a2a736569313333777564323066367670617a3072326d3635336738683974676e7070723033373870656435122a736569313333777564323066367670617a3072326d3635336738683974676e70707230333738706564351a0f0a047573656912073439363030303012670a500a460a1f2f636f736d6f732e63727970746f2e736563703235366b312e5075624b657912230a210309af6232ffa03ed61dc49fbd026cd2a234a84107d06aedc0f71e299675613f3d12040a020801180112130a0d0a0475736569120532303030301090a10f1a0a61746c616e7469632d3220f1ac8404',
        stringifiedSignature: JSON.stringify({
          recid: 1,
          r: '68bd412228e26f44a2e419233d912892aeb0251cfa20198ef7ef99508b9148b9',
          s: '058b0f705f0adf9b02fd5185778620802bd8b1736c0997d154970862a27d74b6',
          y: '0309af6232ffa03ed61dc49fbd026cd2a234a84107d06aedc0f71e299675613f3d',
        }),
      });

    const response = await agent
      .post(`/api/${cosmosLikeCoin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        isTssRecovery: true,
        tssRecoveryParams: {
          commonKeychain:
            '02d4e4db641b9712bf548c4fc12e32ec5d5d0ca9b7a0e3252413975f819209b44c6410c61d2b972ef1bd568684024fd6e09cc2987e87f3b25282af0546b8a26c65',
        },
        recoveryDestinationAddress: 'sei133wud20f6vpaz0r2m653g8h9tgnppr0378ped5',
        coinSpecificParams: {
          ecdsaCosmosLikeRecoverySpecificParams: {
            rootAddress: 'sei133wud20f6vpaz0r2m653g8h9tgnppr0378ped5',
          },
        },
      });

    response.status.should.equal(200);
    response.body.should.have.property('txHex');

    seiChainIdNock.isDone().should.be.true();
    seiAccountDetailsNock.isDone().should.be.true();
    seiBalanceNock.isDone().should.be.true();
    advancedWalletManagerNock.isDone().should.be.true();
  });

  it('should throw 422 Unprocessable Entity for missing coin specific params', async () => {
    const response = await agent
      .post(`/api/${ethLikeCoin}/wallet/recovery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        isTssRecovery: true,
        tssRecoveryParams: {
          commonKeychain:
            '03ee2aa7a0951e0ddf5568c9e0008a824b46324900fa50bd62f43dd75705924d1c4dea9e1138b0fd34b77fa5ead28f24d8dcd053b48144915514ef32941f823075',
        },
        recoveryDestinationAddress: '0x43442e403d64d29c4f64065d0c1a0e8edc03d6c8',
        coinSpecificParams: {},
      });

    response.status.should.equal(422);
    response.body.should.have.property('error');
    response.body.error.should.equal(
      'ECDSA ETH-like recovery specific parameters are required for MPC recovery',
    );
  });
});
