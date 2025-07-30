import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../shared/types';
import express from 'express';

import sinon from 'sinon';
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
      allowSelfSigned: true,
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
      .query({ source: 'user', useLocalEncipherment: false })
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
});
