import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../shared/types';
import express from 'express';

import * as sinon from 'sinon';
import coinFactory from '../../../shared/coinFactory';
import { BaseCoin } from '@bitgo-beta/sdk-core';

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
