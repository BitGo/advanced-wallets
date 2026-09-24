import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../initConfig';
import { app as advancedWalletManagerApp } from '../../../advancedWalletManagerApp';

import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { createHash, X509Certificate } from 'crypto';
import nock from 'nock';
import 'should';
import * as request from 'supertest';
import * as sinon from 'sinon';
import * as configModule from '../../../initConfig';
import { DklsTypes, DklsUtils } from '@bitgo-beta/sdk-lib-mpc';

describe('recoveryMpcV2', () => {
  let cfg: AdvancedWalletManagerConfig;
  let app: express.Application;
  let agent: request.SuperAgentTest;
  let server: https.Server;
  const testCert = fs.readFileSync(path.resolve(__dirname, '../../../../certs/test-ssl-cert.pem'));
  const testKey = fs.readFileSync(path.resolve(__dirname, '../../../../certs/test-ssl-key.pem'));
  const fingerprint = new X509Certificate(testCert).fingerprint256.replace(/:/g, '').toUpperCase();

  // test config
  const keyProviderUrl = 'https://key-provider.invalid';
  const ethLikeCoin = 'hteth';
  const cosmosLikeCoin = 'tsei';
  const accessToken = 'test-token';

  // sinon sandbox
  const sandbox = sinon.createSandbox();
  let configStub: sinon.SinonStub;

  // key provider nocks setup
  let userKeyShare: string;
  let backupKeyShare: string;
  let commonKeychain: string;
  let mockKeyProviderUserResponse: { prv: string; pub: string; source: string; type: string };
  let mockKeyProviderBackupResponse: { prv: string; pub: string; source: string; type: string };
  let input: { txHex: string; pub: string };

  before(async () => {
    const [userShare, backupShare] = await DklsUtils.generateDKGKeyShares();
    userKeyShare = userShare.getKeyShare().toString('base64');
    backupKeyShare = backupShare.getKeyShare().toString('base64');
    commonKeychain = DklsTypes.getCommonKeychain(userShare.getKeyShare());

    mockKeyProviderUserResponse = {
      prv: JSON.stringify(userKeyShare),
      pub: commonKeychain,
      source: 'user',
      type: 'tss',
    };

    mockKeyProviderBackupResponse = {
      prv: JSON.stringify(backupKeyShare),
      pub: commonKeychain,
      source: 'backup',
      type: 'tss',
    };

    input = {
      txHex:
        '02f6824268018502540be4008504a817c80083030d409443442e403d64d29c4f64065d0c1a0e8edc03d6c88801550f7dca700000823078c0',
      pub: commonKeychain,
    };

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
      keyProviderUrl: keyProviderUrl,
      httpLoggerFile: '',
      tlsMode: TlsMode.MTLS,
      mtlsAllowedClientFingerprints: [fingerprint],
      mpcv2RecoveryAllowedClientFingerprints: [fingerprint],
      mpcv2RecoveryApprovals: [
        {
          coin: ethLikeCoin,
          pub: commonKeychain,
          txHexSha256: createHash('sha256').update(Buffer.from(input.txHex, 'hex')).digest('hex'),
        },
        {
          coin: cosmosLikeCoin,
          pub: commonKeychain,
          txHexSha256: createHash('sha256').update(Buffer.from(input.txHex, 'hex')).digest('hex'),
        },
      ],
      clientCertAllowSelfSigned: true,
      recoveryMode: true,
    };

    configStub = sandbox.stub(configModule, 'initConfig').returns(cfg);

    // app setup
    app = advancedWalletManagerApp(cfg);
    server = https.createServer({ cert: testCert, key: testKey, requestCert: true, rejectUnauthorized: false }, app);
    agent = request.agent(server);
  });

  beforeEach(() => {
    nock('https://app.bitgo-test.com')
      .get('/api/v1/client/constants')
      .reply(200, { constants: {} });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    sandbox.restore();
    server.close();
  });

  // happy path test
  it('should be sign a Mpc V2 Recovery', async () => {
    // nocks for key provider responses
    const userKeyProviderNock = nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKeyProviderUserResponse)
      .persist();
    const backupKeyProviderNock = nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'backup' })
      .reply(200, mockKeyProviderBackupResponse)
      .persist();

    const ethLikeSignatureResponse = await agent
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .cert(testCert).key(testKey).ca(testCert)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    ethLikeSignatureResponse.status.should.equal(200);
    ethLikeSignatureResponse.body.should.have.property('txHex');
    ethLikeSignatureResponse.body.txHex.should.equal(input.txHex);

    ethLikeSignatureResponse.body.should.have.property('stringifiedSignature');
    const ethLikeSignature = JSON.parse(ethLikeSignatureResponse.body.stringifiedSignature);
    ethLikeSignature.should.have.property('recid');
    ethLikeSignature.should.have.property('r');
    ethLikeSignature.should.have.property('s');
    ethLikeSignature.should.have.property('y');

    const cosmosLikeSignatureResponse = await agent
      .post(`/api/${cosmosLikeCoin}/mpcv2/recovery`)
      .cert(testCert).key(testKey).ca(testCert)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    cosmosLikeSignatureResponse.status.should.equal(200);
    cosmosLikeSignatureResponse.body.should.have.property('txHex');
    cosmosLikeSignatureResponse.body.txHex.should.equal(input.txHex);

    cosmosLikeSignatureResponse.body.should.have.property('stringifiedSignature');
    const cosmosLikeSignature = JSON.parse(cosmosLikeSignatureResponse.body.stringifiedSignature);
    cosmosLikeSignature.should.have.property('recid');
    cosmosLikeSignature.should.have.property('r');
    cosmosLikeSignature.should.have.property('s');
    cosmosLikeSignature.should.have.property('y');

    userKeyProviderNock.isDone().should.be.true();
    backupKeyProviderNock.isDone().should.be.true();
  });

  it('rejects shares that do not belong to the approved wallet', async () => {
    const [differentWalletShare] = await DklsUtils.generateDKGKeyShares();
    const userKeyRequest = nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKeyProviderUserResponse);
    const backupKeyRequest = nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'backup' })
      .reply(200, {
        ...mockKeyProviderBackupResponse,
        prv: differentWalletShare.getKeyShare().toString('base64'),
      });

    const response = await agent
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .cert(testCert).key(testKey).ca(testCert)
      .send(input);

    response.status.should.equal(400);
    response.body.details.should.equal('Recovery key shares do not match the approved wallet');
    userKeyRequest.isDone().should.be.true();
    backupKeyRequest.isDone().should.be.true();
  });

  it('should route backup key retrieval to backup KMS when configured', async () => {
    const kmsUrl = 'https://kms.invalid';
    const backupKmsUrl = 'https://backup-kms.invalid';

    const mockKmsUserResponse = {
      prv: JSON.stringify(userKeyShare),
      pub: commonKeychain,
      source: 'user',
      type: 'tss',
    };

    const mockKmsBackupResponse = {
      prv: JSON.stringify(backupKeyShare),
      pub: commonKeychain,
      source: 'backup',
      type: 'tss',
    };

    // Reconfigure app with backup KMS URL
    const dualCfg: AdvancedWalletManagerConfig = {
      ...cfg,
      keyProviderUrl: kmsUrl,
      backupKmsUrl,
    };
    configStub.returns(dualCfg);
    const dualApp = advancedWalletManagerApp(dualCfg);
    const dualServer = https.createServer({ cert: testCert, key: testKey, requestCert: true, rejectUnauthorized: false }, dualApp);
    const dualAgent = request.agent(dualServer);

    // User key served from primary KMS
    const userKmsNock = nock(kmsUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKmsUserResponse)
      .persist();

    // Backup key served from backup KMS
    const backupKmsNock = nock(backupKmsUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'backup' })
      .reply(200, mockKmsBackupResponse)
      .persist();

    const response = await dualAgent
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .cert(testCert).key(testKey).ca(testCert)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    response.status.should.equal(200);
    response.body.should.have.property('txHex');
    response.body.should.have.property('stringifiedSignature');

    userKmsNock.isDone().should.be.true();
    backupKmsNock.isDone().should.be.true();
    dualServer.close();
  });

  it('rejects malformed unsigned transaction bytes before retrieving shares', async () => {
    const input = {
      txHex: 'invalid-hex',
      pub: commonKeychain,
    };

    const keyRequest = nock(keyProviderUrl)
      .get(`/key/${input.pub}`)
      .query({ source: 'user' })
      .reply(200, mockKeyProviderUserResponse);

    const signatureResponse = await agent
      .post(`/api/${ethLikeCoin}/mpcv2/recovery`)
      .cert(testCert).key(testKey).ca(testCert)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input);

    signatureResponse.status.should.equal(400);
    signatureResponse.body.should.have.property('error');
    signatureResponse.body.error.should.equal('BadRequestError');
    signatureResponse.body.should.have.property('details');
    signatureResponse.body.details.should.equal('Recovery transaction must be non-empty hex bytes');
    keyRequest.isDone().should.be.false();
  });
});

describe('mpcv2 recovery with recovery mode disabled', () => {
  it('rejects before retrieving either private share', async () => {
    const keyProviderUrl = 'https://key-provider.invalid';
    const config: AdvancedWalletManagerConfig = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      keyProviderUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      recoveryMode: false,
    };
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    const pub = 'synthetic-common-keychain';
    const keyRequest = nock(keyProviderUrl)
      .get(`/key/${pub}`)
      .query({ source: 'user' })
      .reply(200, { prv: 'synthetic-private-share' });
    const response = await request.agent(advancedWalletManagerApp(config))
      .post('/api/hteth/mpcv2/recovery')
      .send({ pub, txHex: '02f6824268018502540be4008504a817c80083030d409443442e403d64d29c4f64065d0c1a0e8edc03d6c88801550f7dca700000823078c0' });

    response.status.should.equal(500);
    response.body.details.should.equal(
      'Recovery operations are not enabled. The server must be in recovery mode to perform this action.',
    );
    keyRequest.isDone().should.be.false();
    nock.cleanAll();
  });
});

describe('mpcv2 recovery authorization', () => {
  const testCert = fs.readFileSync(path.resolve(__dirname, '../../../../certs/test-ssl-cert.pem'));
  const testKey = fs.readFileSync(path.resolve(__dirname, '../../../../certs/test-ssl-key.pem'));
  const fingerprint = new X509Certificate(testCert).fingerprint256.replace(/:/g, '').toUpperCase();
  const pub = 'ab'.repeat(65);
  const txHex = 'deadbeef';
  const keyProviderUrl = 'https://key-provider.invalid';
  const cfg: AdvancedWalletManagerConfig = {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    signingMode: SigningMode.LOCAL,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    keyProviderUrl,
    tlsMode: TlsMode.MTLS,
    clientCertAllowSelfSigned: true,
    recoveryMode: true,
    mtlsAllowedClientFingerprints: [fingerprint],
    mpcv2RecoveryAllowedClientFingerprints: [fingerprint],
    mpcv2RecoveryApprovals: [{
      coin: 'hteth',
      pub,
      txHexSha256: createHash('sha256').update(Buffer.from(txHex, 'hex')).digest('hex'),
    }],
  };
  const app = advancedWalletManagerApp(cfg);
  const server = https.createServer(
    { cert: testCert, key: testKey, requestCert: true, rejectUnauthorized: false },
    app,
  );
  const agent = request.agent(server);

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterEach(() => nock.cleanAll());
  after(() => server.close());

  it('rejects missing mTLS identity even with recovery mode enabled', async () => {
    const keyRequest = nock(keyProviderUrl).get(`/key/${pub}`).query({ source: 'user' }).reply(200);
    const response = await agent.post('/api/hteth/mpcv2/recovery')
      .ca(testCert).send({ pub, txHex });
    response.status.should.equal(403);
    keyRequest.isDone().should.be.false();
  });

  it('rejects a generally allowed mTLS client lacking recovery access before key lookup', async () => {
    cfg.mpcv2RecoveryAllowedClientFingerprints = [];
    const keyRequest = nock(keyProviderUrl).get(`/key/${pub}`).query({ source: 'user' }).reply(200);
    try {
      const response = await agent.post('/api/hteth/mpcv2/recovery')
        .cert(testCert).key(testKey).ca(testCert).send({ pub, txHex });
      response.status.should.equal(403);
      response.body.details.should.equal('Client is not authorized for MPCv2 recovery');
      keyRequest.isDone().should.be.false();
    } finally {
      cfg.mpcv2RecoveryAllowedClientFingerprints = [fingerprint];
    }
  });

  it('rejects recovery when no operator approvals are configured', async () => {
    const approvals = cfg.mpcv2RecoveryApprovals;
    cfg.mpcv2RecoveryApprovals = undefined;
    const keyRequest = nock(keyProviderUrl).get(`/key/${pub}`).query({ source: 'user' }).reply(200);
    try {
      const response = await agent.post('/api/hteth/mpcv2/recovery')
        .cert(testCert).key(testKey).ca(testCert).send({ pub, txHex });
      response.status.should.equal(403);
      response.body.details.should.equal('Wallet and transaction are not approved for MPCv2 recovery');
      keyRequest.isDone().should.be.false();
    } finally {
      cfg.mpcv2RecoveryApprovals = approvals;
    }
  });

  it('rejects an unapproved transaction before key lookup', async () => {
    const keyRequest = nock(keyProviderUrl).get(`/key/${pub}`).query({ source: 'user' }).reply(200);
    const response = await agent.post('/api/hteth/mpcv2/recovery')
      .cert(testCert).key(testKey).ca(testCert).send({ pub, txHex: 'deadbeee' });
    response.status.should.equal(403);
    response.body.details.should.equal('Wallet and transaction are not approved for MPCv2 recovery');
    keyRequest.isDone().should.be.false();
  });

  it('rejects a wallet not on the approved list before key lookup', async () => {
    const keyRequest = nock(keyProviderUrl).get('/key/other-wallet').query({ source: 'user' }).reply(200);
    const response = await agent.post('/api/hteth/mpcv2/recovery')
      .cert(testCert).key(testKey).ca(testCert).send({ pub: 'other-wallet', txHex });
    response.status.should.equal(403);
    response.body.details.should.equal('Wallet and transaction are not approved for MPCv2 recovery');
    keyRequest.isDone().should.be.false();
  });
});
