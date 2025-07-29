import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../initConfig';
import { app as expressApp } from '../../../advancedWalletManagerApp';

import express from 'express';
import nock from 'nock';
import 'should';
import * as request from 'supertest';

describe('postMpcV2Key', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test config
  const kmsUrl = 'http://kms.invalid';
  const coin = 'tsol';
  const accessToken = 'test-token';

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

    // app setup
    app = expressApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should bubble up 400 KMS errors', async () => {
    nock(kmsUrl).post(/.*/).reply(400, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(400);
    response.body.should.have.property('error', 'BadRequestError');
    response.body.should.have.property('details', 'This is an error message');
  });

  it('should bubble up 404 KMS errors', async () => {
    nock(kmsUrl).post(/.*/).reply(404, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(404);
    response.body.should.have.property('error', 'NotFoundError');
    response.body.should.have.property('details', 'This is an error message');
  });

  it('should bubble up 409 KMS errors', async () => {
    nock(kmsUrl).post(/.*/).reply(409, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(409);
    response.body.should.have.property('error', 'ConflictError');
    response.body.should.have.property('details', 'This is an error message');
  });

  it('should bubble up 500 KMS errors', async () => {
    nock(kmsUrl).post(/.*/).reply(500, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details', 'This is an error message');
  });

  it('should handle unexpected KMS errors', async () => {
    nock(kmsUrl).post(/.*/).reply(502, { message: 'Unexpected error' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property(
      'details',
      'KMS returned unexpected response. 502: Unexpected error',
    );
  });
});
