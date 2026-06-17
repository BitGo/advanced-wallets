import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import * as utxolib from '@bitgo-beta/utxo-lib';
import { Btc } from '@bitgo-beta/sdk-coin-btc';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { Environments, Wallet } from '@bitgo-beta/sdk-core';
import {
  ASYNC_TEST_BRIDGE_URL,
  BitGoAPITestHarness,
  makeMasterExpressTestConfig,
  nockAsyncMultisigSignJob,
} from './testUtils';
import assert from 'assert';

const BTC_PREBUILD_PSBT_HEX = utxolib.bitgo
  .createPsbtForNetwork({ network: utxolib.networks.bitcoin })
  .toHex();

describe('POST /api/v1/:coin/advancedwallet/:walletId/consolidateunspents', () => {
  let agent: request.SuperAgentTest;
  const coin = 'btc';
  const walletId = 'test-wallet-id';
  const accessToken = 'test-access-token';
  const bitgoApiUrl = Environments.test.uri;
  const advancedWalletManagerUrl = 'https://test-advanced-wallet-manager.com';

  const mockWalletData = {
    id: walletId,
    type: 'advanced',
    keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
    coin: coin,
    label: 'Test Wallet',
  };

  const mockUserKeychain = {
    id: 'user-key-id',
    pub: 'xpub661MyMwAqRbcEtjU21VjQhGDdg5noG6kCGjcpc4EZwnLUxr9Pi56i14Eek8CQqcuGVnXQf3Zy47Uizr5WHDbZ3GumXEFXpwFLHWGbKrWWcg',
    type: 'independent',
  };

  const mockBackupKeychain = {
    id: 'backup-key-id',
    pub: 'xpub661MyMwAqRbcEnTrcp222pRm7G1ZAbDD3KxXT2XEKRe3jnnvydqnyssewd2eUxgeWr1c1ffHcqqRKB8j3Lw9VR4dvrAhTov4kPKZF5rs6Vr',
    type: 'independent',
  };

  const mockBitgoKeychain = {
    id: 'bitgo-key-id',
    pub: 'xpub661MyMwAqRbcFNUFGFmDcC3Frgtz4FnJqFdCGbzLva2hf5i3ZJuQdsGc3z5FXCVqR9NQ6h2zTyGcQkfFtsLT5St621Fcu1C22kCKhbo4kQy',
    type: 'bitgo',
  };

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config = makeMasterExpressTestConfig(advancedWalletManagerUrl);
    agent = request.agent(expressApp(config));
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    BitGoAPITestHarness.clearConstantsCache();
  });

  // Nocks wallet and all 3 keychains with persist() to handle multiple fetches
  function nockWalletAndKeychains() {
    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBitgoKeychain);
  }

  it('should succeed in consolidating unspents with user key', async () => {
    nockWalletAndKeychains();

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} });

    sinon.stub(Btc.prototype, 'verifyTransaction').resolves(true);

    const signNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

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

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .reply(200, mockResult);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
      maxFeeRate: 2000,
      minValue: 1000,
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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

    signNock.done();
    submitNock.done();
  });

  it('should succeed in consolidating unspents with backup key', async () => {
    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBitgoKeychain);

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} });

    sinon.stub(Btc.prototype, 'verifyTransaction').resolves(true);

    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'backup',
        pub: mockBackupKeychain.pub,
      });

    const mockResult = {
      txid: 'backup-consolidation-tx-id',
      tx: '01000000000102backup...',
      status: 'signed',
    };

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .reply(200, mockResult);

    const requestPayload = {
      pubkey: mockBackupKeychain.pub,
      source: 'backup' as const,
      feeRate: 1500,
      bulk: true,
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('txid', mockResult.txid);
    response.body.should.have.property('tx', mockResult.tx);
    response.body.should.have.property('status', mockResult.status);

    submitNock.done();
  });

  it('should handle array result from consolidateUnspents and return first element', async () => {
    nockWalletAndKeychains();

    // Build returns an array of 1 prebuild
    // SDK returns array of 1 send result
    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, [{ txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} }]);

    sinon.stub(Btc.prototype, 'verifyTransaction').resolves(true);

    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

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

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .reply(200, mockArrayResult[0]);

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
      bulk: true,
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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

    submitNock.done();
  });

  it('should fail when consolidateUnspents returns array with more than one element', async () => {
    nockWalletAndKeychains();

    // Build returns 2 prebuilds, SDK signs+sends both, returns array of 2, handler throws
    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, [
        { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} },
        { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} },
      ]);

    sinon.stub(Btc.prototype, 'verifyTransaction').resolves(true);

    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .times(2)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .times(2)
      .reply(200, { txid: 'some-tx-id', status: 'signed' });

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(400);
    response.body.error.should.equal('BadRequestError');
    response.body.details.should.containEql(
      'Expected single consolidation result, but received 2 results',
    );
  });

  it('should succeed in consolidating unspents with all optional parameters', async () => {
    nockWalletAndKeychains();

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} });

    sinon.stub(Btc.prototype, 'verifyTransaction').resolves(true);

    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

    const mockResult = {
      txid: 'full-params-consolidation-tx-id',
      tx: '01000000000102full...',
      status: 'signed',
    };

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .reply(200, mockResult);

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
    };

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('txid', mockResult.txid);
    response.body.should.have.property('tx', mockResult.tx);
    response.body.should.have.property('status', mockResult.status);

    submitNock.done();
  });

  it('should fail when wallet is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Wallet not found', name: 'WalletNotFoundError' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
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
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when consolidateUnspents throws an error', async () => {
    nockWalletAndKeychains();

    // Make the build endpoint fail with a server error to cause consolidateUnspents to throw
    const buildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(500, { error: 'No unspents available for consolidation' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    response.body.should.have.property('details');

    buildNock.done();
  });

  it('should fail when pubkey parameter is not a string', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 12345,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should pass walletPubs (all 3 xpubs) to AWM for UTXO signing', async () => {
    nockWalletAndKeychains();

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} });

    sinon.stub(Btc.prototype, 'verifyTransaction').resolves(true);

    let capturedSignBody: any;
    const awmSignNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`, (body) => {
        capturedSignBody = body;
        return true;
      })
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .reply(200, { txid: 'consolidate-tx-id', tx: '01000000...', status: 'signed' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(200);
    awmSignNock.done();
    capturedSignBody.should.have.property('walletPubs');
    capturedSignBody.walletPubs.should.deepEqual([
      mockUserKeychain.pub,
      mockBackupKeychain.pub,
      mockBitgoKeychain.pub,
    ]);
  });

  it('should omit walletPubs from AWM request when any keychain is missing a pub', async () => {
    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { id: 'backup-key-id' }); // no pub

    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBitgoKeychain);

    let capturedSignBody: any;
    const awmSignNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`, (body) => {
        capturedSignBody = body;
        return true;
      })
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

    // The real consolidateUnspents (via manageUnspents) asserts k.pub on every keychain when
    // building pubs before signTransaction is called, so this case never reaches customSigningFunction
    sinon.stub(Wallet.prototype, 'consolidateUnspents').callsFake(async (params: any) => {
      await params.customSigningFunction({ txPrebuild: { txHex: 'prebuilt-tx' } });
      return { txid: 'consolidate-tx-id', tx: '01000000...', status: 'signed' };
    });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(200);
    awmSignNock.done();
    capturedSignBody.should.not.have.property('walletPubs');
  });

  it('should return 202 with jobId when async mode is enabled for onchain multisig consolidateUnspents', async () => {
    const jobId = 'test-consolidate-unspents-job-id';
    const asyncConfig = makeMasterExpressTestConfig(advancedWalletManagerUrl, {
      asyncEnabled: true,
    });
    const asyncAgent = request.agent(expressApp(asyncConfig));

    nockWalletAndKeychains();

    let capturedBuildBody: Record<string, unknown> | undefined;
    const buildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`, (body) => {
        capturedBuildBody = body;
        return true;
      })
      .reply(200, { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} });

    sinon.stub(Btc.prototype, 'verifyTransaction').resolves(true);

    let capturedJobBody: Record<string, unknown> | undefined;
    const { bridgeNock, awmSignNock } = nockAsyncMultisigSignJob({
      coin,
      advancedWalletManagerUrl,
      jobId,
      captureJobBody: (body) => {
        capturedJobBody = body;
      },
    });

    const requestPayload = {
      pubkey: mockUserKeychain.pub,
      source: 'user' as const,
      feeRate: 1000,
      maxFeeRate: 2000,
      minValue: 1000,
    };

    const response = await asyncAgent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(202);
    response.body.should.have.property('jobId', jobId);
    response.body.should.have.property('status', 'pending');

    assert(capturedBuildBody, 'capturedBuildBody is undefined');
    capturedBuildBody.should.have.property('feeRate', 1000);
    capturedBuildBody.should.have.property('maxFeeRate', 2000);
    capturedBuildBody.should.have.property('minValue', 1000);
    capturedBuildBody.should.have.property('txFormat', 'psbt-lite');

    assert(capturedJobBody, 'capturedJobBody is undefined');
    capturedJobBody.should.have.property('wpSubmitKind', 'consolidateUnspents');
    (capturedJobBody.wpSubmitParams as Record<string, unknown>).should.have.property(
      'feeRate',
      1000,
    );
    (capturedJobBody.wpSubmitParams as Record<string, unknown>).should.have.property(
      'txFormat',
      'psbt-lite',
    );
    (capturedJobBody.wpSubmitParams as Record<string, unknown>).should.not.have.property('reqId');
    (capturedJobBody.walletPubs as string[]).should.deepEqual([
      mockUserKeychain.pub,
      mockBackupKeychain.pub,
      mockBitgoKeychain.pub,
    ]);

    buildNock.done();
    bridgeNock.done();
    awmSignNock.isDone().should.be.false();
  });

  it('should fail when async mode is enabled with bulk consolidateUnspents', async () => {
    const asyncConfig = makeMasterExpressTestConfig(advancedWalletManagerUrl, {
      asyncEnabled: true,
    });
    const asyncAgent = request.agent(expressApp(asyncConfig));

    nockWalletAndKeychains();

    const response = await asyncAgent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
        bulk: true,
      });

    response.status.should.equal(400);
    response.body.details.should.containEql('Async mode does not support bulk consolidateUnspents');
  });

  it('should fail when async consolidateUnspents prebuild returns more than one result', async () => {
    const asyncConfig = makeMasterExpressTestConfig(advancedWalletManagerUrl, {
      asyncEnabled: true,
    });
    const asyncAgent = request.agent(expressApp(asyncConfig));

    nockWalletAndKeychains();

    const buildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, [
        { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} },
        { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} },
      ]);

    const bridgeNock = nock(ASYNC_TEST_BRIDGE_URL)
      .post(`/api/${coin}/multisig/sign`)
      .reply(202, { jobId: 'should-not-reach-bridge' });

    const response = await asyncAgent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(400);
    response.body.error.should.equal('BadRequestError');
    response.body.details.should.containEql(
      'Expected single consolidation result, but received 2 results',
    );

    buildNock.done();
    bridgeNock.isDone().should.be.false();
  });

  it('should fail when async transaction verification returns false', async () => {
    const asyncConfig = makeMasterExpressTestConfig(advancedWalletManagerUrl, {
      asyncEnabled: true,
    });
    const asyncAgent = request.agent(expressApp(asyncConfig));

    nockWalletAndKeychains();

    const buildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/consolidateUnspents`)
      .reply(200, { txHex: BTC_PREBUILD_PSBT_HEX, txInfo: {} });

    const verifyStub = sinon.stub(Btc.prototype, 'verifyTransaction').resolves(false);

    const response = await asyncAgent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        feeRate: 1000,
      });

    response.status.should.equal(400);
    response.body.details.should.containEql('Transaction prebuild failed local validation');

    buildNock.done();
    sinon.assert.calledOnce(verifyStub);
  });
});
