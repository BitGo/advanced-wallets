import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import sinon from 'sinon';
import * as middleware from '../../../shared/middleware';
import * as masterMiddleware from '../../../api/master/middleware/middleware';
import { BitGoRequest } from '../../../types/request';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { AdvancedWalletManagerClient } from '../../../api/master/clients/advancedWalletManagerClient';
import { CoinFamily } from '@bitgo-beta/statics';
import coinFactory from '../../../shared/coinFactory';

describe('Recovery Tests', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const accessToken = 'test-token';
  const config: MasterExpressConfig = {
    appMode: AppMode.MASTER_EXPRESS,
    port: 0,
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
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const bitgo = new BitGoAPI({ env: 'test' });

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).bitgo = bitgo;
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

  describe('UTXO coin recovery', () => {
    let mockRecover: sinon.SinonStub;
    let mockIsValidPub: sinon.SinonStub;
    let mockRecoverResponse: any;
    const coin = 'tbtc';

    beforeEach(() => {
      // Setup mock response for UTXO recovery
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
      // coinStub.withArgs(coin).returns(mockCoin);
      sinon
        .stub(coinFactory, 'getCoin')
        .withArgs(coin)
        .returns(mockCoin as any);

      // Setup coin middleware
      sinon.stub(masterMiddleware, 'validateMasterExpressConfig').callsFake((req, res, next) => {
        (req as BitGoRequest<MasterExpressConfig>).params = { coin };
        (req as BitGoRequest<MasterExpressConfig>).awmClient = new AdvancedWalletManagerClient(
          config,
          coin,
        );
        next();
        return undefined;
      });
    });

    it('should recover a UTXO wallet by calling the advanced wallet manager service', async () => {
      const userPub = 'xpub_user';
      const backupPub = 'xpub_backup';
      const bitgoPub = 'xpub_bitgo';
      const recoveryDestination = 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu';

      // Mock the advanced wallet manager recovery call
      const recoveryNock = nock(advancedWalletManagerUrl)
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
            utxoRecoveryOptions: {
              scan: 1,
            },
          },
        });

      response.status.should.equal(200);
      response.body.should.have.property('txHex');
      response.body.txHex.should.equal(
        '01000000000101edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f41702790400473044022043a9256810ef47ce36a092305c0b1ef675bce53e46418eea8cacbf1643e541d90220450766e048b841dac658d0a2ba992628bfe131dff078c3a574cadf67b4946647014730440220360045a15e459ed44aa3e52b86dd6a16dddaf319821f4dcc15627686f377edd102205cb3d5feab1a773c518d43422801e01dd1bc586bb09f6a9ed23a1fc0cfeeb5310169522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae00000000',
      );

      // Verify SDK coin method calls
      // coinStub.calledWith(coin).should.be.true();
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

      // Verify advanced wallet manager call
      recoveryNock.done();
    });

    it('should reject incorrect EVM parameters for a UTXO coin', async () => {
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

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'UTXO recovery options are required for UTXO coin recovery',
      );
    });

    it('should reject incorrect Solana parameters for a UTXO coin', async () => {
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
            solanaRecoveryOptions: {
              tokenContractAddress: 'tokenAddress123',
              closeAtaAddress: 'closeAddress123',
              recoveryDestinationAtaAddress: 'destAddress123',
              programId: 'programId123',
            },
          },
        });

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'UTXO recovery options are required for UTXO coin recovery',
      );
    });

    it('should reject using legacy coinSpecificParams format', async () => {
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
            addressScan: 1, // Legacy format (not nested under utxo)
          },
        });

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'UTXO recovery options are required for UTXO coin recovery',
      );
    });
  });

  describe('EVM coin recovery', () => {
    // Setup mocks for ETH
    const ethCoinId = 'hteth';

    beforeEach(() => {
      // Setup coin middleware for ETH coin
      sinon.stub(masterMiddleware, 'validateMasterExpressConfig').callsFake((req, res, next) => {
        (req as BitGoRequest<MasterExpressConfig>).params = { coin: ethCoinId };
        (req as BitGoRequest<MasterExpressConfig>).awmClient = new AdvancedWalletManagerClient(
          config,
          ethCoinId,
        );
        next();
        return undefined;
      });
    });

    it('should reject incorrect UTXO parameters for an ETH coin', async () => {
      const userPub = 'xpub_user';
      const backupPub = 'xpub_backup';
      const bitgoPub = 'xpub_bitgo';
      const recoveryDestination = '0x1234567890123456789012345678901234567890';
      const walletContractAddress = '0x0987654321098765432109876543210987654321';

      const response = await agent
        .post(`/api/${ethCoinId}/wallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multiSigRecoveryParams: {
            userPub,
            backupPub,
            bitgoPub,
            walletContractAddress,
          },
          recoveryDestinationAddress: recoveryDestination,
          coin: ethCoinId,
          apiKey: 'key',
          coinSpecificParams: {
            utxoRecoveryOptions: {
              scan: 1,
              ignoreAddressTypes: ['p2sh'],
            },
          },
        });

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'EVM recovery options are required for ETH-like coin recovery',
      );
    });

    it('should reject incorrect Solana parameters for an ETH coin', async () => {
      const userPub = 'xpub_user';
      const backupPub = 'xpub_backup';
      const bitgoPub = 'xpub_bitgo';
      const recoveryDestination = '0x1234567890123456789012345678901234567890';
      const walletContractAddress = '0x0987654321098765432109876543210987654321';

      const response = await agent
        .post(`/api/${ethCoinId}/wallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multiSigRecoveryParams: {
            userPub,
            backupPub,
            bitgoPub,
            walletContractAddress,
          },
          recoveryDestinationAddress: recoveryDestination,
          coin: ethCoinId,
          apiKey: 'key',
          coinSpecificParams: {
            solanaRecoveryOptions: {
              tokenContractAddress: 'tokenAddress123',
              closeAtaAddress: 'closeAddress123',
              recoveryDestinationAtaAddress: 'destAddress123',
              programId: 'programId123',
            },
          },
        });

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'EVM recovery options are required for ETH-like coin recovery',
      );
    });
  });

  describe('Solana coin recovery', () => {
    // Setup mocks for Solana
    const solCoinId = 'tsol';
    const solExplorerUrl = 'https://api.devnet.solana.com';

    beforeEach(() => {
      // Setup coin middleware for Solana coin
      sinon.stub(masterMiddleware, 'validateMasterExpressConfig').callsFake((req, res, next) => {
        (req as BitGoRequest<MasterExpressConfig>).params = { coin: solCoinId };
        (req as BitGoRequest<MasterExpressConfig>).awmClient = new AdvancedWalletManagerClient(
          config,
          solCoinId,
        );
        next();
        return undefined;
      });
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('should sign a solana recovery successfully', async () => {
      const solAccountBalanceNock = nock(solExplorerUrl)
        .post('/')
        .matchHeader('any', () => true)
        .reply(200, {
          result: {
            value: 1000000000,
          },
        });

      const solBlockHashNock = nock(solExplorerUrl)
        .post('/')
        .matchHeader('any', () => true)
        .reply(200, {
          result: {
            value: {
              blockhash: 'FvGuZFQqWtjDCgpPgA2CJ9WgDKc7i1HioJcn9j5PX8xu',
            },
          },
        });

      const solFeeNock = nock(solExplorerUrl)
        .post('/')
        .matchHeader('any', () => true)
        .reply(200, {
          result: {
            value: 5000,
          },
        });

      const awmNock = nock(advancedWalletManagerUrl)
        .post(`/api/${solCoinId}/mpc/recovery`)
        .reply(200, {
          txHex:
            'AWkNYn5JOxl5bLmFN8BB/Yyz8pLvrNpyZ6fUiTDpSnkK9dtts5VEBQOdLEaG3D18sN8dPxhnS+TzmmuUPMl0WAUBAAECvoOqYkvCPusjYyhX4GdUtzSeVIcx6GkwdpSk8SkU0/cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIQtFGO2YBsrubq15CKqJLwXG3VEF1aEs36Rao6EaJDLAQECAAAMAgAAALhJxgAAAAAA',
        });

      const response = await agent
        .post(`/api/${solCoinId}/wallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          isTssRecovery: true,
          tssRecoveryParams: {
            commonKeychain:
              'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174',
          },
          recoveryDestinationAddress: 'DpgugQVWnNbTQr6jqLvkHQVWa43WTGWb7jH5zeNGJjtA',
          coinSpecificParams: {
            solanaRecoveryOptions: {}, // none are required for token recoveries
          },
        });

      response.status.should.equal(200);
      response.body.should.have.property('txHex');

      solAccountBalanceNock.isDone().should.be.true();
      solBlockHashNock.isDone().should.be.true();
      solFeeNock.isDone().should.be.true();
      awmNock.isDone().should.be.true();
    });

    it('should reject incorrect UTXO parameters for a Solana coin', async () => {
      const userPub = 'solana_pubkey';
      const recoveryDestination = 'solanaRecoveryAddress123456789012345678901234';

      const response = await agent
        .post(`/api/${solCoinId}/wallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          isTssRecovery: true,
          tssRecoveryParams: {
            commonKeychain: userPub,
          },
          recoveryDestinationAddress: recoveryDestination,
          coin: solCoinId,
          apiKey: 'key',
          coinSpecificParams: {
            utxoRecoveryOptions: {
              scan: 1,
              ignoreAddressTypes: ['p2sh'],
            },
          },
        });

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'Solana recovery options are required for EdDSA coin recovery',
      );
    });

    it('should reject incorrect EVM parameters for a Solana coin', async () => {
      const userPub = 'solana_pubkey';
      const recoveryDestination = 'solanaRecoveryAddress123456789012345678901234';

      const response = await agent
        .post(`/api/${solCoinId}/wallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          isTssRecovery: true,
          tssRecoveryParams: {
            commonKeychain: userPub,
          },
          recoveryDestinationAddress: recoveryDestination,
          coin: solCoinId,
          apiKey: 'key',
          coinSpecificParams: {
            evmRecoveryOptions: {
              gasPrice: 20000000000,
              gasLimit: 500000,
            },
          },
        });

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'Solana recovery options are required for EdDSA coin recovery',
      );
    });
  });

  describe('Sui coin recovery', () => {
    // Setup mocks for Sui
    const suiCoinId = 'tsui';
    const suiExplorerUrl = 'https://fullnode.testnet.sui.io';

    beforeEach(() => {
      // Setup coin middleware for Sui coin
      sinon.stub(masterMiddleware, 'validateMasterExpressConfig').callsFake((req, res, next) => {
        (req as BitGoRequest<MasterExpressConfig>).params = { coin: suiCoinId };
        (req as BitGoRequest<MasterExpressConfig>).awmClient = new AdvancedWalletManagerClient(
          config,
          suiCoinId,
        );
        next();
        return undefined;
      });
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('should sign a sui recovery successfully', async () => {
      const suiAccountBalanceNock = nock(suiExplorerUrl)
        .post('/')
        .matchHeader('any', () => true)
        .reply(200, {
          result: {
            coinType: '0x2::sui::SUI',
            coinObjectCount: 1,
            totalBalance: '1000000000',
            lockedBalance: {},
          },
        });

      const suiInputCoinsNock = nock(suiExplorerUrl)
        .post('/')
        .matchHeader('any', () => true)
        .reply(200, {
          result: {
            data: [
              {
                coinType: '0x2::sui::SUI',
                coinObjectId: '0x1a4951d0006f16326d5b74df71b5c81450b4cc74d9f1c357e6e1665d5ca9a067',
                version: '349180327',
                digest: 'F1vZCzDD36oKjqMWu9mPo57g1SfznFQnbHLNf436efGx',
                balance: '1000000000',
                previousTransaction: '9Wnh785m4DLCZfQSrSou6HrNr8kTygDxDBuAnnPZ9rFE',
              },
            ],
            hasNextPage: false,
          },
        });

      const suiFeeEstimateNock = nock(suiExplorerUrl)
        .post('/')
        .matchHeader('any', () => true)
        .reply(200, {
          result: {
            effects: {
              messageVersion: 'v1',
              status: { status: 'success' },
              executedEpoch: '823',
              gasUsed: {
                computationCost: '1000000',
                storageCost: '1976000',
                storageRebate: '978120',
                nonRefundableStorageFee: '9880',
              },
              modifiedAtVersions: [[Object]],
              transactionDigest: 'CDKmL6HU1HEa8SHevU9bgtapWjPoa5i1tykpu6Ut9pvb',
              created: [[Object]],
              mutated: [[Object]],
              gasObject: { owner: [Object], reference: [Object] },
              dependencies: ['9Wnh785m4DLCZfQSrSou6HrNr8kTygDxDBuAnnPZ9rFE'],
            },
          },
        });

      const awmNock = nock(advancedWalletManagerUrl)
        .post(`/api/${suiCoinId}/mpc/recovery`)
        .reply(200, {
          txHex:
            'AAACAAhcQXk7AAAAAAAgzB1x/fqyCinQhAMGI6aC6G8lTz5qCBNMwDfeN/6pSyECAgABAQAAAQECAAABAQDMHXH9+rIKKdCEAwYjpoLobyVPPmoIE0zAN943/qlLIQEaSVHQAG8WMm1bdN9xtcgUULTMdNnxw1fm4WZdXKmgZ6cR0BQAAAAAINBALBBncQWazDJGoUWnuszVEvSZ8IaXb+doVp11G7ANzB1x/fqyCinQhAMGI6aC6G8lTz5qCBNMwDfeN/6pSyHoAwAAAAAAAKSIIQAAAAAAAA==',
        });

      const response = await agent
        .post(`/api/${suiCoinId}/wallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          isTssRecovery: true,
          tssRecoveryParams: {
            commonKeychain:
              'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174',
          },
          recoveryDestinationAddress:
            '0xcc1d71fdfab20a29d084030623a682e86f254f3e6a08134cc037de37fea94b21',
        });

      response.status.should.equal(200);
      response.body.should.have.property('txHex');

      suiAccountBalanceNock.isDone().should.be.true();
      suiInputCoinsNock.isDone().should.be.true();
      suiFeeEstimateNock.isDone().should.be.true();
      awmNock.isDone().should.be.true();
    });
  });
});
