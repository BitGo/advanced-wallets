import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as enclavedApp } from '../../../enclavedApp';
import { AppMode, EnclavedConfig, TlsMode } from '../../../shared/types';
import express from 'express';

import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';

describe('postIndependentKey', () => {
  let cfg: EnclavedConfig;
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
      appMode: AppMode.ENCLAVED,
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
    app = enclavedApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    configStub.restore();
  });

  // test cases
  it('should post an independent key successfully', async () => {
    const mockKmsResponse = {
      coin: coin,
      pub: 'xpub661MyMwAqRbcGAEfZmG74QD11P4dCKRkuwpsJG87QKVPcMdA1PLe76de1Ted54rZ2gyqLYhmdhBCFMrt7AoVwPZwXa3Na9aUnvndvXbvmwu',
      source: 'user',
      type: 'independent',
    };

    const kmsNock = nock(kmsUrl).post(`/key`).reply(200, mockKmsResponse);

    const response = await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(200);
    response.body.should.have.property('pub', mockKmsResponse.pub);
    response.body.should.have.property('coin', mockKmsResponse.coin);
    response.body.should.have.property('source', mockKmsResponse.source);

    kmsNock.done();
  });

  it('should fail to post an independent key if source is not provided', async () => {
    const response = await agent
      .post(`/api/${coin}/key/independent`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    response.status.should.equal(400);
  });
});
