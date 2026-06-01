import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import * as utxolib from '@bitgo-beta/utxo-lib';
import { Tbtc } from '@bitgo-beta/sdk-coin-btc';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo-beta/sdk-core';
import { BitGoAPITestHarness } from './testUtils';

const TBTC_PREBUILD_PSBT_HEX = utxolib.bitgo
  .createPsbtForNetwork({ network: utxolib.networks.testnet })
  .toHex();

describe('POST /api/v1/:coin/advancedwallet/:walletId/accelerate', () => {
  let agent: request.SuperAgentTest;
  const coin = 'tbtc';
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

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0, // Let OS assign a free port
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
    BitGoAPITestHarness.clearConstantsCache();
  });

  after(() => {
    nock.enableNetConnect();
  });

  // Keychains are fetched by getWalletAndSigningKeychain, getWalletPubs and getKeysForSigning
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

  it('should succeed in accelerating transaction with CPFP using user key', async () => {
    nockWalletAndKeychains();

    let capturedBuildBody: any;
    const buildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`, (body) => {
        capturedBuildBody = body;
        return true;
      })
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

    const signNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { txid: 'accelerated-tx-id-123', tx: '0100000001abcdef...', status: 'signed' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user' as const,
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
        cpfpFeeRate: 50,
        maxFee: 10000,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'accelerated-tx-id-123');
    response.body.should.have.property('tx', '0100000001abcdef...');

    buildNock.done();
    signNock.done();
    submitNock.done();
    // Acceleration params are forwarded to the SDK build request
    capturedBuildBody.should.have.property('cpfpTxIds');
    capturedBuildBody.should.have.property('cpfpFeeRate', 50);
    capturedBuildBody.should.have.property('maxFee', 10000);
  });

  it('should succeed in accelerating transaction with RBF using backup key', async () => {
    nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockWalletData);

    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBackupKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);
    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/bitgo-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockBitgoKeychain);

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

    const signNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'backup',
        pub: mockBackupKeychain.pub,
      });

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { txid: 'rbf-accelerated-tx-id', tx: '0100000001fedcba...' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockBackupKeychain.pub,
        source: 'backup' as const,
        rbfTxIds: ['a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890'],
        feeMultiplier: 1.5,
        maxFee: 15000,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'rbf-accelerated-tx-id');
    response.body.should.have.property('tx', '0100000001fedcba...');

    signNock.done();
    submitNock.done();
  });

  it('should succeed in accelerating transaction with all optional parameters', async () => {
    nockWalletAndKeychains();

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

    nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/multisig/sign`)
      .reply(200, {
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: mockUserKeychain.pub,
      });

    const submitNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/send`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { txid: 'accelerated-with-all-params', tx: '0100000001abcdef123...' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user' as const,
        cpfpTxIds: ['tx1'],
        cpfpFeeRate: 100,
        maxFee: 20000,
      });

    response.status.should.equal(200);
    response.body.should.have.property('txid', 'accelerated-with-all-params');
    response.body.should.have.property('tx', '0100000001abcdef123...');
    submitNock.done();
  });

  it('should fail when wallet is not found', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(404, { error: 'Wallet not found', name: 'WalletNotFoundError' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
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
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 'xpub661MyMwAqRbcWRONG_PUBKEY_THAT_DOES_NOT_MATCH',
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should fail when required pubkey parameter is missing', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when required source parameter is missing', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when source parameter has invalid value', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'invalid_source',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when authorization header is missing', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when transaction build fails', async () => {
    nockWalletAndKeychains();

    const buildNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(400, { error: 'Insufficient funds for acceleration' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
        cpfpFeeRate: 100,
        maxFee: 10000,
      });

    response.status.should.be.aboveOrEqual(400);
    response.body.should.have.property('error');
    buildNock.done();
  });

  it('should fail when cpfpTxIds parameter is not an array', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: 'not-an-array',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when rbfTxIds parameter is not an array', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        rbfTxIds: 'not-an-array',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when pubkey parameter is not a string', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: 12345,
        source: 'user',
        cpfpTxIds: ['test-tx-id'],
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when both cpfpTxIds and rbfTxIds are missing', async () => {
    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should pass walletPubs (all 3 xpubs) to AWM for UTXO signing', async () => {
    nockWalletAndKeychains();

    nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/${walletId}/tx/build`)
      .reply(200, {
        txHex: TBTC_PREBUILD_PSBT_HEX,
        txInfo: { nP2SHInputs: 1, nSegwitInputs: 0, nOutputs: 2 },
      });
    nock(bitgoApiUrl).get(`/api/v2/${coin}/public/block/latest`).reply(200, { height: 800000 });

    sinon.stub(Tbtc.prototype, 'verifyTransaction').resolves(true);

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
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { txid: 'accelerated-tx-id', tx: '0100000001abcdef...', status: 'signed' });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
        cpfpFeeRate: 50,
        maxFee: 10000,
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
      .persist()
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, mockUserKeychain);

    nock(bitgoApiUrl)
      .persist()
      .get(`/api/v2/${coin}/key/backup-key-id`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, { id: 'backup-key-id' }); // no pub

    nock(bitgoApiUrl)
      .persist()
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

    // The real accelerateTransaction (via prebuildAndSignTransaction) asserts k.pub on every onchain
    // keychain when building signingParams.pubs, so this case never reaches customSigningFunction
    sinon.stub(Wallet.prototype, 'accelerateTransaction').callsFake(async (params: any) => {
      await params.customSigningFunction({ txPrebuild: { txHex: 'prebuilt-tx' } });
      return { txid: 'accelerated-tx-id', tx: '0100000001abcdef...', status: 'signed' };
    });

    const response = await agent
      .post(`/api/v1/${coin}/advancedwallet/${walletId}/accelerate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pubkey: mockUserKeychain.pub,
        source: 'user',
        cpfpTxIds: ['b8a828b98dbf32d9fd1875cbace9640ceb8c82626716b4a64203fdc79bb46d26'],
        cpfpFeeRate: 50,
      });

    response.status.should.equal(200);
    awmSignNock.done();
    capturedSignBody.should.not.have.property('walletPubs');
  });
});
