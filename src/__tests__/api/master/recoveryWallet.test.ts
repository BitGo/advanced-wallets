import 'should';
import * as request from 'supertest';
import nock from 'nock';
import sinon from 'sinon';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import {
  BitGoAPITestHarness,
  DEFAULT_ASYNC_MODE_CONFIG,
  makeMasterExpressTestConfig,
  nockAsyncMultisigRecoveryJob,
} from './testUtils';

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
    asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG,
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

  describe('UTXO coin recovery', () => {
    const coin = 'tbtc';
    const userPub =
      'xpub661MyMwAqRbcEtjU21VjQhGDdg5noG6kCGjcpc4EZwnLUxr9Pi56i14Eek8CQqcuGVnXQf3Zy47Uizr5WHDbZ3GumXEFXpwFLHWGbKrWWcg';
    const backupPub =
      'xpub661MyMwAqRbcEnTrcp222pRm7G1ZAbDD3KxXT2XEKRe3jnnvydqnyssewd2eUxgeWr1c1ffHcqqRKB8j3Lw9VR4dvrAhTov4kPKZF5rs6Vr';
    const bitgoPub =
      'xpub661MyMwAqRbcFNUFGFmDcC3Frgtz4FnJqFdCGbzLva2hf5i3ZJuQdsGc3z5FXCVqR9NQ6h2zTyGcQkfFtsLT5St621Fcu1C22kCKhbo4kQy';

    const addrWithFunds = 'tb1qs5efv9zqhrc4sne7zphmsxea3cg9m262v6phsqn5dfdwed8ykx4s4wj67d';

    it('should recover a UTXO wallet by calling the advanced wallet manager service', async () => {
      const recoveryDestination = 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu';
      const blockchairBase = 'https://api.blockchair.com';

      const balanceNock = nock(blockchairBase)
        .get(`/bitcoin/testnet/dashboards/address/${addrWithFunds}?key=key`)
        .reply(200, {
          data: { [addrWithFunds]: { address: { transaction_count: 1, balance: 4000 } } },
        });

      const unspentsNock = nock(blockchairBase)
        .get(`/bitcoin/testnet/dashboards/addresses/${addrWithFunds}?key=key`)
        .reply(200, {
          data: {
            utxo: [
              {
                transaction_hash:
                  '3bc8f46fcbbc04e4b4a61f1a67a2cca381254524ca6d5e26bfaaf5fe83a5d7ed',
                index: 0,
                recipient: addrWithFunds,
                value: 4000,
                block_id: 100,
                spending_transaction_hash: null,
                spending_index: null,
                address: addrWithFunds,
              },
            ],
          },
        });

      // All other address lookups return empty (persistent regex fallback).
      // Handles all chains at index 0 with no balance, plus chain-20 index 1.
      nock(blockchairBase)
        .persist()
        .get(/\/bitcoin\/testnet\/dashboards\/address\/[^?]+\?key=key/)
        .reply(function (uri) {
          const match = uri.match(/\/dashboards\/address\/([^?]+)\?/);
          const addr = match ? decodeURIComponent(match[1]) : 'unknown';
          return [200, { data: { [addr]: { address: { transaction_count: 0, balance: 0 } } } }];
        });

      // mempool.space fee rate (called when feeRate param is undefined)
      const feeNock = nock('https://mempool.space')
        .get('/api/v1/fees/recommended')
        .reply(200, { fastestFee: 20, halfHourFee: 10, hourFee: 5 });

      // The real SDK builds a dynamic PSBT; body matcher
      const recoveryNock = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/multisig/recovery`, (body) => {
          return (
            body.userPub === userPub &&
            body.backupPub === backupPub &&
            body.bitgoPub === bitgoPub &&
            body.walletContractAddress === '' &&
            body.unsignedSweepPrebuildTx !== undefined &&
            body.unsignedSweepPrebuildTx.txHex !== undefined
          );
        })
        .reply(200, {
          txHex:
            '01000000000101edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f41702790400473044022043a9256810ef47ce36a092305c0b1ef675bce53e46418eea8cacbf1643e541d90220450766e048b841dac658d0a2ba992628bfe131dff078c3a574cadf67b4946647014730440220360045a15e459ed44aa3e52b86dd6a16dddaf319821f4dcc15627686f377edd102205cb3d5feab1a773c518d43422801e01dd1bc586bb09f6a9ed23a1fc0cfeeb5310169522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae00000000',
        });

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

      balanceNock.isDone().should.be.true();
      unspentsNock.isDone().should.be.true();
      feeNock.isDone().should.be.true();
      recoveryNock.done();
    });

    it('should reject incorrect EVM parameters for a UTXO coin', async () => {
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

      response.status.should.equal(422);
      response.body.should.have.property('error');
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'UTXO recovery options are required for UTXO coin recovery',
      );
    });

    it('should reject incorrect Solana parameters for a UTXO coin', async () => {
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
    const ethCoinId = 'hteth';

    const ethUserPub =
      'xpub661MyMwAqRbcFigezGWEYSbCPVuaUmvnp1u7iEpH9YsKU6uYQtPANvudjgAo82QRHXsUieMqKeB1xEj89VUKU1ugtmyAZ3xzNEbHPexxgKK';
    const ethBackupPub =
      'xpub661MyMwAqRbcGbCirzmQsUJT2eidt9tFLw2m77w6FiKco6TKu49CP3GkHF88xGCpvqkP93SYMAarfyWAn8UWevQtNT6pDo8xH7xmf6GqK6e';

    it('should recover an EVM wallet by calling the advanced wallet manager service', async () => {
      const recoveryDestination = '0x1234567890123456789012345678901234567890';
      const walletContractAddress = '0x0987654321098765432109876543210987654321';
      const backupKeyAddress = '0x30edc88a77598833f58947638b2ac3d5713d9845';
      const etherscanBase = 'https://api.etherscan.io';
      const chainid = '560048'; // Holesky testnet (hteth)
      const apiKey = 'key';

      // Etherscan txlist for backup key nonce (called twice: recoverEthLike + formatForOfflineVault)
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
          `/v2/api?chainid=${chainid}&module=account&action=balance&address=${walletContractAddress}&apikey=${apiKey}`,
        )
        .reply(200, { result: '1000000000000000000' });

      const sequenceIdNock = nock(etherscanBase)
        .get(
          `/v2/api?chainid=${chainid}&module=proxy&action=eth_call&to=${walletContractAddress}&data=a0b7967b&tag=latest&apikey=${apiKey}`,
        )
        .reply(200, {
          result: '0x0000000000000000000000000000000000000000000000000000000000000001',
        });

      // The real SDK builds a dynamic unsignedSweepPrebuildTx; body matcher
      const recoveryNock = nock(advancedWalletManagerUrl)
        .post(`/api/${ethCoinId}/multisig/recovery`, (body) => {
          return (
            body.userPub === ethUserPub &&
            body.backupPub === ethBackupPub &&
            body.walletContractAddress === walletContractAddress &&
            body.unsignedSweepPrebuildTx !== undefined
          );
        })
        .reply(200, { txHex: 'eth-signed-tx-hex' });

      const response = await agent
        .post(`/api/v1/${ethCoinId}/advancedwallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multiSigRecoveryParams: {
            userPub: ethUserPub,
            backupPub: ethBackupPub,
            bitgoPub: '',
            walletContractAddress,
          },
          recoveryDestinationAddress: recoveryDestination,
          coin: ethCoinId,
          apiKey,
          coinSpecificParams: {
            evmRecoveryOptions: {},
          },
        });

      response.status.should.equal(200);
      response.body.should.have.property('txHex', 'eth-signed-tx-hex');
      txlistNock.isDone().should.be.true();
      backupBalanceNock.isDone().should.be.true();
      walletBalanceNock.isDone().should.be.true();
      sequenceIdNock.isDone().should.be.true();
      recoveryNock.done();
    });

    it('should reject incorrect UTXO parameters for an ETH coin', async () => {
      const recoveryDestination = '0x1234567890123456789012345678901234567890';
      const walletContractAddress = '0x0987654321098765432109876543210987654321';

      const response = await agent
        .post(`/api/v1/${ethCoinId}/advancedwallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multiSigRecoveryParams: {
            userPub: ethUserPub,
            backupPub: ethBackupPub,
            bitgoPub: '',
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
      const recoveryDestination = '0x1234567890123456789012345678901234567890';
      const walletContractAddress = '0x0987654321098765432109876543210987654321';

      const response = await agent
        .post(`/api/v1/${ethCoinId}/advancedwallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multiSigRecoveryParams: {
            userPub: ethUserPub,
            backupPub: ethBackupPub,
            bitgoPub: '',
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
        .post(`/api/v1/${solCoinId}/advancedwallet/recovery`)
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
        .post(`/api/v1/${solCoinId}/advancedwallet/recovery`)
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
        .post(`/api/v1/${solCoinId}/advancedwallet/recovery`)
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
        .post(`/api/v1/${suiCoinId}/advancedwallet/recovery`)
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

  describe('Async mode', () => {
    const jobId = 'recovery-job-id-123';
    const asyncConfig = makeMasterExpressTestConfig(advancedWalletManagerUrl, {
      asyncEnabled: true,
      overrides: { recoveryMode: true, disableEnvCheck: true },
    });
    let asyncAgent: request.SuperAgentTest;

    before(() => {
      asyncAgent = request.agent(expressApp(asyncConfig));
    });

    it('should return 202 + jobId for UTXO multisig recovery, submitting to the bridge not AWM', async () => {
      const coin = 'tbtc';
      const userPub =
        'xpub661MyMwAqRbcEtjU21VjQhGDdg5noG6kCGjcpc4EZwnLUxr9Pi56i14Eek8CQqcuGVnXQf3Zy47Uizr5WHDbZ3GumXEFXpwFLHWGbKrWWcg';
      const backupPub =
        'xpub661MyMwAqRbcEnTrcp222pRm7G1ZAbDD3KxXT2XEKRe3jnnvydqnyssewd2eUxgeWr1c1ffHcqqRKB8j3Lw9VR4dvrAhTov4kPKZF5rs6Vr';
      const bitgoPub =
        'xpub661MyMwAqRbcFNUFGFmDcC3Frgtz4FnJqFdCGbzLva2hf5i3ZJuQdsGc3z5FXCVqR9NQ6h2zTyGcQkfFtsLT5St621Fcu1C22kCKhbo4kQy';
      const addrWithFunds = 'tb1qs5efv9zqhrc4sne7zphmsxea3cg9m262v6phsqn5dfdwed8ykx4s4wj67d';
      const recoveryDestination = 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu';
      const blockchairBase = 'https://api.blockchair.com';

      nock(blockchairBase)
        .get(`/bitcoin/testnet/dashboards/address/${addrWithFunds}?key=key`)
        .reply(200, {
          data: { [addrWithFunds]: { address: { transaction_count: 1, balance: 4000 } } },
        });
      nock(blockchairBase)
        .get(`/bitcoin/testnet/dashboards/addresses/${addrWithFunds}?key=key`)
        .reply(200, {
          data: {
            utxo: [
              {
                transaction_hash:
                  '3bc8f46fcbbc04e4b4a61f1a67a2cca381254524ca6d5e26bfaaf5fe83a5d7ed',
                index: 0,
                recipient: addrWithFunds,
                value: 4000,
                block_id: 100,
                spending_transaction_hash: null,
                spending_index: null,
                address: addrWithFunds,
              },
            ],
          },
        });
      nock(blockchairBase)
        .persist()
        .get(/\/bitcoin\/testnet\/dashboards\/address\/[^?]+\?key=key/)
        .reply(function (uri) {
          const match = uri.match(/\/dashboards\/address\/([^?]+)\?/);
          const addr = match ? decodeURIComponent(match[1]) : 'unknown';
          return [200, { data: { [addr]: { address: { transaction_count: 0, balance: 0 } } } }];
        });
      nock('https://mempool.space').get('/api/v1/fees/recommended').reply(200, {
        fastestFee: 20,
        halfHourFee: 10,
        hourFee: 5,
      });

      let capturedBody: Record<string, unknown> | undefined;
      const { bridgeNock, awmRecoveryNock } = nockAsyncMultisigRecoveryJob({
        coin,
        advancedWalletManagerUrl,
        jobId,
        captureJobBody: (body) => {
          capturedBody = body;
        },
      });

      const response = await asyncAgent
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
          coinSpecificParams: { utxoRecoveryOptions: { scan: 1 } },
        });

      response.status.should.equal(202);
      response.body.should.have.property('jobId', jobId);
      response.body.should.have.property('status', 'pending');
      bridgeNock.done();
      awmRecoveryNock.isDone().should.be.false();
      const body = capturedBody as Record<string, unknown>;
      body.should.have.property('userPub', userPub);
      body.should.have.property('backupPub', backupPub);
      body.should.have.property('bitgoPub', bitgoPub);
      body.should.have.property('unsignedSweepPrebuildTx');
    });

    it('should return 202 + jobId for EVM multisig recovery, submitting to the bridge not AWM', async () => {
      const ethCoinId = 'hteth';
      const ethUserPub =
        'xpub661MyMwAqRbcFigezGWEYSbCPVuaUmvnp1u7iEpH9YsKU6uYQtPANvudjgAo82QRHXsUieMqKeB1xEj89VUKU1ugtmyAZ3xzNEbHPexxgKK';
      const ethBackupPub =
        'xpub661MyMwAqRbcGbCirzmQsUJT2eidt9tFLw2m77w6FiKco6TKu49CP3GkHF88xGCpvqkP93SYMAarfyWAn8UWevQtNT6pDo8xH7xmf6GqK6e';
      const recoveryDestination = '0x1234567890123456789012345678901234567890';
      const walletContractAddress = '0x0987654321098765432109876543210987654321';
      const backupKeyAddress = '0x30edc88a77598833f58947638b2ac3d5713d9845';
      const etherscanBase = 'https://api.etherscan.io';
      const chainid = '560048';
      const apiKey = 'key';

      nock(etherscanBase)
        .get(
          `/v2/api?chainid=${chainid}&module=account&action=txlist&address=${backupKeyAddress}&apikey=${apiKey}`,
        )
        .twice()
        .reply(200, { result: [] });
      nock(etherscanBase)
        .get(
          `/v2/api?chainid=${chainid}&module=account&action=balance&address=${backupKeyAddress}&apikey=${apiKey}`,
        )
        .reply(200, { result: '10000000000000000' });
      nock(etherscanBase)
        .get(
          `/v2/api?chainid=${chainid}&module=account&action=balance&address=${walletContractAddress}&apikey=${apiKey}`,
        )
        .reply(200, { result: '1000000000000000000' });
      nock(etherscanBase)
        .get(
          `/v2/api?chainid=${chainid}&module=proxy&action=eth_call&to=${walletContractAddress}&data=a0b7967b&tag=latest&apikey=${apiKey}`,
        )
        .reply(200, {
          result: '0x0000000000000000000000000000000000000000000000000000000000000001',
        });

      let capturedBody: Record<string, unknown> | undefined;
      const { bridgeNock, awmRecoveryNock } = nockAsyncMultisigRecoveryJob({
        coin: ethCoinId,
        advancedWalletManagerUrl,
        jobId,
        captureJobBody: (body) => {
          capturedBody = body;
        },
      });

      const response = await asyncAgent
        .post(`/api/v1/${ethCoinId}/advancedwallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multiSigRecoveryParams: {
            userPub: ethUserPub,
            backupPub: ethBackupPub,
            bitgoPub: '',
            walletContractAddress,
          },
          recoveryDestinationAddress: recoveryDestination,
          coin: ethCoinId,
          apiKey,
          coinSpecificParams: { evmRecoveryOptions: {} },
        });

      response.status.should.equal(202);
      response.body.should.have.property('jobId', jobId);
      response.body.should.have.property('status', 'pending');
      bridgeNock.done();
      awmRecoveryNock.isDone().should.be.false();
      const body = capturedBody as Record<string, unknown>;
      body.should.have.property('userPub', ethUserPub);
      body.should.have.property('backupPub', ethBackupPub);
      body.should.have.property('unsignedSweepPrebuildTx');
    });

    it('should reject async mode for TSS recovery with a 400', async () => {
      const response = await asyncAgent
        .post(`/api/v1/tsol/advancedwallet/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          isTssRecovery: true,
          tssRecoveryParams: {
            commonKeychain:
              'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174',
          },
          recoveryDestinationAddress: 'DpgugQVWnNbTQr6jqLvkHQVWa43WTGWb7jH5zeNGJjtA',
          coinSpecificParams: { solanaRecoveryOptions: {} },
        });

      response.status.should.equal(400);
      response.body.should.have.property('details');
      response.body.details.should.containEql(
        'Async mode is not yet supported for TSS/MPC recovery',
      );
    });
  });
});
