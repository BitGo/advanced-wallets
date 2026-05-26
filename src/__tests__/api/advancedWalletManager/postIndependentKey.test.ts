import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../shared/types';
import express from 'express';

import * as sinon from 'sinon';
import coinFactory from '../../../shared/coinFactory';
import { BaseCoin } from '@bitgo-beta/sdk-core';
import { CoinFamily } from '@bitgo-beta/statics';

describe('postIndependentKey', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test cofig
  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'hteth';
  const accessToken = 'test-token';

  // sinon stubs

  before(() => {
    // nock config
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      keyProviderUrl: keyProviderUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    // app setup
    app = advancedWalletManagerApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // test cases
  it('should post an independent key successfully', async () => {
    const mockKeyProviderResponse = {
      coin: coin,
      pub: 'xpub661MyMwAqRbcGAEfZmG74QD11P4dCKRkuwpsJG87QKVPcMdA1PLe76de1Ted54rZ2gyqLYhmdhBCFMrt7AoVwPZwXa3Na9aUnvndvXbvmwu',
      source: 'user',
      type: 'independent',
    };

    const keyProviderNock = nock(keyProviderUrl).post(`/key`).reply(200, mockKeyProviderResponse);

    const response = await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(200);
    response.body.should.have.property('pub', mockKeyProviderResponse.pub);
    response.body.should.have.property('coin', mockKeyProviderResponse.coin);
    response.body.should.have.property('source', mockKeyProviderResponse.source);

    keyProviderNock.done();
  });

  it('should fail to post an independent key if source is not provided', async () => {
    const response = await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    response.status.should.equal(400);
  });

  it('should fail if there is an error in creating the public and private key pairs', async () => {
    const coinStub = sinon.stub(coinFactory, 'getCoin').returns(
      Promise.resolve({
        getFamily: () => CoinFamily.ETH,
        keychains: () => ({
          create: () => ({}),
        }),
      } as unknown as BaseCoin),
    );

    const response = await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(500);
    response.body.should.have.property('details', 'BitGo SDK failed to create public key');

    coinStub.restore();
  });
});

describe('postIndependentKey — external signing mode', () => {
  let app: express.Application;
  let agent: request.SuperAgentTest;
  let coinStub: sinon.SinonStub;

  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'tbtc';
  const accessToken = 'test-token';
  const mockGenerateKeyResponse = {
    pub: 'xpub661MyMwAq',
    coin,
    source: 'user',
    type: 'independent',
  };

  const utxoCoinStub = {
    getFamily: () => CoinFamily.BTC,
    getFullName: () => 'Test Bitcoin',
    keychains: () => ({ create: sinon.stub().returns({ pub: 'xpub...', prv: 'xprv...' }) }),
  } as unknown as BaseCoin;

  const nonUtxoCoinStub = {
    getFamily: () => CoinFamily.ETH,
    getFullName: () => 'Test Ethereum',
    keychains: () => ({ create: sinon.stub().returns({ pub: 'xpub...', prv: 'xprv...' }) }),
  } as unknown as BaseCoin;

  const unsupportedExternalCoinStub = {
    getFamily: () => CoinFamily.XRP,
    getFullName: () => 'Test XRP',
    keychains: () => ({ create: sinon.stub().returns({ pub: 'xpub...', prv: 'xprv...' }) }),
  } as unknown as BaseCoin;

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    app = advancedWalletManagerApp({
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.EXTERNAL,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      keyProviderUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    });
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    coinStub?.restore();
  });

  it('should call POST /key/generate for UTXO coin and not call POST /key', async () => {
    coinStub = sinon.stub(coinFactory, 'getCoin').resolves(utxoCoinStub);
    const externalKeyGeneratorNock = nock(keyProviderUrl)
      .post('/key/generate', { coin, source: 'user', type: 'independent' })
      .reply(200, mockGenerateKeyResponse);
    const localKeyGeneratorNock = nock(keyProviderUrl).post('/key').reply(200, {});

    const response = await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(200);
    response.body.should.have.property('pub', mockGenerateKeyResponse.pub);
    externalKeyGeneratorNock.done();
    localKeyGeneratorNock.isDone().should.equal(false);
  });

  it('should not call coin.keychains().create() in external mode for UTXO coin', async () => {
    const createSpy = sinon.spy();
    const utxoWithSpy = {
      ...utxoCoinStub,
      keychains: () => ({ create: createSpy }),
    } as unknown as BaseCoin;
    coinStub = sinon.stub(coinFactory, 'getCoin').resolves(utxoWithSpy);
    nock(keyProviderUrl).post('/key/generate').reply(200, mockGenerateKeyResponse);

    await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'backup' });

    createSpy.called.should.equal(false);
  });

  it('should call POST /key/generate for ETH coin and not call POST /key', async () => {
    coinStub = sinon.stub(coinFactory, 'getCoin').resolves(nonUtxoCoinStub);
    const externalKeyGeneratorNock = nock(keyProviderUrl)
      .post('/key/generate', { coin: 'hteth', source: 'user', type: 'independent' })
      .reply(200, { ...mockGenerateKeyResponse, coin: 'hteth' });
    const localKeyGeneratorNock = nock(keyProviderUrl).post('/key').reply(200, {});

    const response = await agent
      .post(`/api/hteth/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(200);
    response.body.should.have.property('pub', mockGenerateKeyResponse.pub);
    externalKeyGeneratorNock.done();
    localKeyGeneratorNock.isDone().should.equal(false);
  });

  it('should fall through to local path for unsupported external coin in external mode', async () => {
    coinStub = sinon.stub(coinFactory, 'getCoin').resolves(unsupportedExternalCoinStub);
    const externalKeyGeneratorNock = nock(keyProviderUrl).post('/key/generate').reply(200, {});
    nock(keyProviderUrl).post('/key').reply(200, mockGenerateKeyResponse);

    const response = await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(200);
    externalKeyGeneratorNock.isDone().should.equal(false);
  });
});
