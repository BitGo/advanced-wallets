import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../initConfig';
import { app as expressApp } from '../../../advancedWalletManagerApp';
import { KeyProviderClient } from '../../../advancedWalletManager/keyProviderClient/keyProviderClient';

import express from 'express';
import nock from 'nock';
import 'should';
import * as request from 'supertest';

describe('postMpcV2Key', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;

  // test config
  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'tsol';
  const accessToken = 'test-token';

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
    app = expressApp(cfg);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should bubble up 400 key provider errors', async () => {
    nock(keyProviderUrl).post(/.*/).reply(400, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(400);
    response.body.should.have.property('error', 'BadRequestError');
    response.body.should.have.property('details', 'This is an error message');
  });

  it('should bubble up 404 key provider errors', async () => {
    nock(keyProviderUrl).post(/.*/).reply(404, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(404);
    response.body.should.have.property('error', 'NotFoundError');
    response.body.should.have.property('details', 'This is an error message');
  });

  it('should bubble up 409 key provider errors', async () => {
    nock(keyProviderUrl).post(/.*/).reply(409, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(409);
    response.body.should.have.property('error', 'ConflictError');
    response.body.should.have.property('details', 'This is an error message');
  });

  it('should bubble up 500 key provider errors', async () => {
    nock(keyProviderUrl).post(/.*/).reply(500, { message: 'This is an error message' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.details.should.match(/This is an error message/);
  });

  it('should handle unexpected key provider errors', async () => {
    nock(keyProviderUrl).post(/.*/).reply(502, { message: 'Unexpected error' }).persist();

    const response = await agent
      .post(`/api/${coin}/mpcv2/initialize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ source: 'user' });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.details.should.match(/502.*Unexpected error/);
  });
});

describe('KeyProviderClient.generateKey', () => {
  const keyProviderUrl = 'http://key-provider.invalid';
  const endPointPath = '/key/generate';
  const params = { coin: 'hteth', source: 'user' as const, type: 'independent' as const };
  const mockResponse = { pub: 'xpub661MyMwAq', coin: 'hteth', source: 'user', type: 'independent' };
  let client: KeyProviderClient;

  before(() => {
    nock.disableNetConnect();
    client = new KeyProviderClient({
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      keyProviderUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    });
  });

  afterEach(() => nock.cleanAll());

  it('should call POST /key/generate with correct params and return response', async () => {
    const nockMocked = nock(keyProviderUrl).post(endPointPath, params).reply(200, mockResponse);

    const result = await client.generateKey(params);

    result.should.have.property('pub', mockResponse.pub);
    result.should.have.property('coin', mockResponse.coin);
    result.should.have.property('source', mockResponse.source);
    result.should.have.property('type', mockResponse.type);
    nockMocked.done();
  });

  [
    { url: endPointPath, statusCode: 400, mockedError: 'bad request' },
    { url: endPointPath, statusCode: 404, mockedError: 'not found' },
    { url: endPointPath, statusCode: 409, mockedError: 'conflict' },
    { url: endPointPath, statusCode: 500, mockedError: 'internal error' },
  ].forEach(({ url, statusCode, mockedError }) => {
    it(`should bubble up ${statusCode} errors`, async () => {
      const nockMocked = nock(keyProviderUrl)
        .post(url)
        .reply(statusCode, { message: mockedError })
        .persist();
      await client.generateKey(params).should.be.rejectedWith(new RegExp(mockedError));
      nockMocked.done();
    });
  });
});

describe('KeyProviderClient.sign', () => {
  const keyProviderUrl = 'http://key-provider.invalid';
  const endPointPath = '/sign';
  const params = {
    pub: 'xpub661MyMwAq',
    source: 'user' as const,
    signablePayload: 'deadbeef',
    algorithm: 'ecdsa',
  };
  const mockResponse = { signature: 'signedpsbt' };
  let client: KeyProviderClient;

  before(() => {
    nock.disableNetConnect();
    client = new KeyProviderClient({
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      keyProviderUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    });
  });

  afterEach(() => nock.cleanAll());

  it('should call POST /sign with correct params and return signature', async () => {
    const n = nock(keyProviderUrl).post(endPointPath, params).reply(200, mockResponse);

    const result = await client.sign(params);

    result.should.have.property('signature', mockResponse.signature);
    n.done();
  });

  it('should throw if response has no signature', async () => {
    nock(keyProviderUrl).post(endPointPath).reply(200, {});
    await client
      .sign(params)
      .should.be.rejectedWith(/key provider returned unexpected response when signing/);
  });

  [
    { statusCode: 400, mockedError: 'bad request' },
    { statusCode: 404, mockedError: 'not found' },
    { statusCode: 409, mockedError: 'conflict' },
    { statusCode: 500, mockedError: 'internal error' },
  ].forEach(({ statusCode, mockedError }) => {
    it(`should bubble up ${statusCode} errors`, async () => {
      const nockMocked = nock(keyProviderUrl)
        .post(endPointPath)
        .reply(statusCode, { message: mockedError })
        .persist();
      await client.sign(params).should.be.rejectedWith(new RegExp(mockedError));
      nockMocked.done();
    });
  });
});
