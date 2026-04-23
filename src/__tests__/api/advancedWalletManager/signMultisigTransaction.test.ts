import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../shared/types';
import express from 'express';

import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';

describe('signMultisigTransaction', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test cofig
  const kmsUrl = 'http://kms.invalid';
  const coin = 'hteth';
  const accessToken = 'test-token';

  // sinon stubs
  let configStub: sinon.SinonStub;

  before(() => {
    // nock config
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      kmsUrl: kmsUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    configStub = sinon.stub(configModule, 'initConfig').returns(cfg);

    // app setup
    app = advancedWalletManagerApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    configStub.restore();
  });

  // test cases
  it('should half-sign a multisig transaction successfully', async () => {
    const input = {
      source: 'user',
      pub: 'xpub661MyMwAqRbcGAEfZmG74QD11P4dCKRkuwpsJG87QKVPcMdA1PLe76de1Ted54rZ2gyqLYhmdhBCFMrt7AoVwPZwXa3Na9aUnvndvXbvmwu',
      txPrebuild: {
        feeInfo: {
          date: '2025-06-11T16:35:04.622Z',
          gasPrice: '11610471836',
          baseFee: '11478770445',
          gasUsedRatio: '0.9999833170418686',
          safeLowMinerTip: '521229555',
          normalMinerTip: '521229555',
          standardMinerTip: '521229555',
          fastestMinerTip: '521229555',
          ludicrousMinerTip: '550407891',
        },
        eip1559: { maxPriorityFeePerGas: '599413988', maxFeePerGas: '23556954878' },
        recipients: [
          {
            amount: '10000',
            address: '0xe9cbfdf9e02f4ee37ec81683a4be934b4eecc295',
          },
        ],
        nextContractSequenceId: 5,
        gasLimit: 200000,
        isBatch: false,
        coin: 'hteth',
        walletId: '68489ecff6fb16304670b327db8eb31a',
        walletContractAddress: '0xe9cbfdf9e02f4ee37ec81683a4be934b4eecc295',
        reqId: {}, // modified
        wallet: {
          // modified
          bitgo: {},
          baseCoin: {},
          _wallet: {},
        },
        buildParams: {},
      },
    };

    const mockKmsResponse = {
      prv: 'xprv9s21ZrQH143K3gACTjj6hGGGTME8nrhuYiuGVsiVqyxQjZJ1Tr2PZJKAABHLm2gMSwqRmXBXT8VcXppDy43xjwvt9xdgkDSyRPsBUekEaPq',
      pub: 'xpub661MyMwAqRbcGAEfZmG74QD11P4dCKRkuwpsJG87QKVPcMdA1PLe76de1Ted54rZ2gyqLYhmdhBCFMrt7AoVwPZwXa3Na9aUnvndvXbvmwu',
      source: 'user',
      type: 'independent',
    };

    const kmsNock = nock(kmsUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKmsResponse);

    const response = await agent
      .post(`/api/${coin}/multisig/sign`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ source: input.source })
      .send(input);

    response.status.should.equal(200);
    response.body.should.have.property('halfSigned');

    kmsNock.done();
  });

  it('should sign a tbtc PSBT when walletPubs are provided', async () => {
    const txHexPrefix = '70736274ff'; // PSBT magic bytes
    const userPub =
      'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV';
    const backupPub =
      'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH';
    const bitgoPub =
      'xpub661MyMwAqRbcGcBurxn9ptqqKGmMhnKa8D7TeZkaWpfQNTeG4qKEJ67eb6Hy58kZBwPHqjUt5iApUwvFVk9ffQYaV42RRom2p7yU5bcCwpq';

    const txHex = `${txHexPrefix}01005e0100000001edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f4170279000000000001012ba00f00000000000022002008da4d49c618c6a00dc86a962f9c452dc0151653d2630470dcf8375a9f6496a501030401000000010569522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae22060222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e14502e31ca000000000000000014000000000000002206033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e9146700d77100000000000000001400000000000000220603a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae14c2d0eb0a000000000000000014000000000000000000`;

    const kmsNock = nock(kmsUrl).get(`/key/${userPub}`).query({ source: 'user' }).reply(200, {
      prv: 'xprv9s21ZrQH143K2ZbYmTE75wsdaTsiSgsajJnooSi1wBieWRwQ89xSBwAYK1VJR795Y8XFCCXYHHs4sk2Heg6dkX3CHMBq5bw8DwBWByWx883',
      pub: userPub,
      source: 'user',
      type: 'independent',
    });

    const response = await agent
      .post(`/api/tbtc/multisig/sign`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pub: userPub,
        txPrebuild: { txHex },
        walletPubs: [userPub, backupPub, bitgoPub],
      });

    response.status.should.equal(200);
    // BitGoPsbt path returns { txHex } (signed PSBT hex), not { halfSigned }
    response.body.should.have.property('txHex');
    response.body.txHex.should.startWith(txHexPrefix);

    kmsNock.done();
  });
});
