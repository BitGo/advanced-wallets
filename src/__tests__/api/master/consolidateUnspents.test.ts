import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo-beta/sdk-core';

describe('POST /api/:coin/wallet/:walletId/consolidateunspents', () => {
  let agent: request.SuperAgentTest;
  const coin = 'btc';
  const walletId = 'test-wallet-id';
  const accessToken = 'test-access-token';
  const bitgoApiUrl = Environments.test.uri;
  const advancedWalletManagerUrl = 'https://test-advanced-wallet-manager.com';

  const mockWalletData = {
    id: walletId,
    type: 'cold',
    subType: 'onPrem',
    keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
    coin: coin,
    label: 'Test Wallet',
  };

  const mockUserKeychain = {
    id: 'user-key-id',
    pub: 'xpub661MyMwAqRbcFkPHucMnrGNzDwb6teAX1RbKQmqtEF8kK3Z7LZ59qafCjB9eCWzSgHCZkdXgp',
    type: 'independent',
  };

  const mockBackupKeychain = {
    id: 'backup-key-id',
    pub: 'xpub661MyMwAqRbcGaZrYqfYmaTRzQxM9PKEZ7GRb6DKfghkzgjk2dKT4qBXfz6WzpT4N5fXJhFW',
    type: 'independent',
  };

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 30000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: advancedWalletManagerUrl,
      awmServerCaCert: 'test-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should succeed in consolidating unspents with user key', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const mockResult = {
      transfer: {
        entries: [
          { address: 'tb1qu...', value: -4000 },
          { address: 'tb1qle...', value: -4000 },
          { address: 'tb1qtw...', value: 2714, isChange: true },
        ],
        id: '685ac2f3c2f8a2a5d9cc18d3593f1751',
        coin: 'tbtc',
        wallet: '685abbf19ca95b79f88e0b41d9337109',
        txid: '239d143cdfc6d6c83a935da4f3d610b2364a956c7b6dcdc165eb706f62c4432a',
        status: 'signed',
      },
      txid: '239d143cdfc6d6c83a935da4f3d610b2364a956c7b6dcdc165eb706f62c4432a',
      tx: '01000000000102580b...',
      status: 'signed',
    };

    const consolidateUnspentsStub = sinon
      .stub(Wallet.prototype, 'consolidateUnspents')
      .resolves(mockResult);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
      maxFeeRate: 2000,
      minValue: 1000,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('transfer');
    response.body.should.have.property('txid', mockResult.txid);
    response.body.should.have.property('tx', mockResult.tx);
    response.body.should.have.property('status', mockResult.status);
    response.body.transfer.should.have.property('txid', mockResult.transfer.txid);
    response.body.transfer.should.have.property('status', mockResult.transfer.status);
    response.body.transfer.should.have.property('entries').which.is.Array();

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(consolidateUnspentsStub);

    const callArgs = consolidateUnspentsStub.firstCall.args[0];
    callArgs!.should.have.property('feeRate', 1000);
    callArgs!.should.have.property('maxFeeRate', 2000);
    callArgs!.should.have.property('minValue', 1000);
    callArgs!.should.have.property('customSigningFunction');
    callArgs!.should.have.property('reqId');
  });

  it('should succeed in consolidating unspents with backup key', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);

    const mockResult = {
      txid: 'backup-consolidation-tx-id',
      tx: '01000000000102backup...',
      status: 'signed',
    };

    const consolidateUnspentsStub = sinon
      .stub(Wallet.prototype, 'consolidateUnspents')
      .resolves(mockResult);

    const requestPayload = {
      pubkey: mockBackupKeychain.pub,
      source: 'backup' as const,
      feeRate: 1500,
      bulk: true,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('txid', mockResult.txid);
    response.body.should.have.property('tx', mockResult.tx);
    response.body.should.have.property('status', mockResult.status);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(consolidateUnspentsStub);
  });

  it('should handle array result from consolidateUnspents and return first element', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const mockArrayResult = [
      {
        transfer: {
          entries: [
            { address: 'tb1qu...', value: -4000 },
            { address: 'tb1qle...', value: -4000 },
            { address: 'tb1qtw...', value: 2714, isChange: true },
          ],
          id: 'first-transfer-id',
          coin: 'tbtc',
          wallet: '685abbf19ca95b79f88e0b41d9337109',
          txid: 'first-tx-id',
          status: 'signed',
        },
        txid: 'first-tx-id',
        tx: '01000000000102first...',
        status: 'signed',
      },
    ];

    const consolidateUnspentsStub = sinon
      .stub(Wallet.prototype, 'consolidateUnspents')
      .resolves(mockArrayResult);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
      bulk: true,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    // Should return only the first element from the array
    response.body.should.have.property('transfer');
    response.body.should.have.property('txid', 'first-tx-id');
    response.body.should.have.property('tx', '01000000000102first...');
    response.body.should.have.property('status', 'signed');
    response.body.transfer.should.have.property('id', 'first-transfer-id');
    response.body.transfer.should.have.property('txid', 'first-tx-id');
    response.body.transfer.should.have.property('status', 'signed');
    response.body.transfer.should.have.property('entries').which.is.Array();

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(consolidateUnspentsStub);
  });

  it('should fail when consolidateUnspents returns array with more than one element', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const mockArrayResult = [
      {
        txid: 'first-tx-id',
        tx: '01000000000102first...',
        status: 'signed',
      },
      {
        txid: 'second-tx-id',
        tx: '01000000000102second...',
        status: 'signed',
      },
    ];

    const consolidateUnspentsStub = sinon
      .stub(Wallet.prototype, 'consolidateUnspents')
      .resolves(mockArrayResult);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('name', 'Error');
    response.body.should.have.property(
      'details',
      'Expected single consolidation result, but received 2 results',
    );

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(consolidateUnspentsStub);
  });

  it('should succeed in consolidating unspents with all optional parameters', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const mockResult = {
      txid: 'full-params-consolidation-tx-id',
      tx: '01000000000102full...',
      status: 'signed',
    };

    const consolidateUnspentsStub = sinon
      .stub(Wallet.prototype, 'consolidateUnspents')
      .resolves(mockResult);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
      maxFeeRate: 2000,
      maxFeePercentage: 10,
      feeTxConfirmTarget: 6,
      bulk: true,
      minValue: 1000,
      maxValue: 50000,
      minHeight: 100000,
      minConfirms: 3,
      enforceMinConfirmsForChange: true,
      limit: 100,
      numUnspentsToMake: 10,
      targetAddress: 'tb1q...',
      txFormat: 'psbt' as const,
    };

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('txid', mockResult.txid);
    response.body.should.have.property('tx', mockResult.tx);
    response.body.should.have.property('status', mockResult.status);

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(consolidateUnspentsStub);
  });

  it('should fail when wallet is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Wallet not found', name: 'WalletNotFoundError' });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(404);
    response.body.should.have.property('error');
    walletGetNock.done();
  });

  it('should fail when signing keychain is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Keychain not found', name: 'KeychainNotFoundError' });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(404);
    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when provided pubkey does not match wallet keychain', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 'xpub661MyMwAqRbcWRONG_PUBKEY_THAT_DOES_NOT_MATCH',
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when required pubkey parameter is missing', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when required source parameter is missing', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        feeRate: 1000,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when source parameter has invalid value', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'invalid_source',
        feeRate: 1000,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when authorization header is missing', async () => {
    const response = await agent.post(`/api/${coin}/wallet/${walletId}/consolidateunspents`).send({
      pubkey: mockUserKeychain.pub,
      source: 'user',
      feeRate: 1000,
    });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when consolidateUnspents throws an error', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    const consolidateUnspentsStub = sinon
      .stub(Wallet.prototype, 'consolidateUnspents')
      .rejects(new Error('No unspents available for consolidation'));

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('name', 'Error');
    response.body.should.have.property('details', 'No unspents available for consolidation');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(consolidateUnspentsStub);
  });

  it('should fail when pubkey parameter is not a string', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 12345,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });
});
