import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../advancedWalletManagerApp';
import { AppMode, AdvancedWalletManagerConfig, TlsMode, SigningMode } from '../../../shared/types';
import sinon from 'sinon';
import * as middleware from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import { BitGoAPI as BitGo } from '@bitgo-beta/sdk-api';
import * as keyProviderUtils from '../../../advancedWalletManager/handlers/utils/utils';
import coinFactory from '../../../shared/coinFactory';
import { BaseCoin } from '@bitgo-beta/sdk-core';
import { CoinFamily } from '@bitgo-beta/statics';

describe('UTXO recovery', () => {
  let agent: request.SuperAgentTest;
  let mockRetrieveKeyProviderPrvKey: sinon.SinonStub;
  const coin = 'tbtc';
  const config: AdvancedWalletManagerConfig = {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    signingMode: SigningMode.LOCAL,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    tlsMode: TlsMode.DISABLED,
    clientCertAllowSelfSigned: true,
    keyProviderUrl: 'key-provider.example.com',
    recoveryMode: true,
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // Initialize BitGo with test environment
    const bitgo = new BitGo({
      env: 'test',
      accessToken: 'test_token',
    });

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<AdvancedWalletManagerConfig>).bitgo = bitgo;
      (req as BitGoRequest<AdvancedWalletManagerConfig>).config = config;
      next();
    });

    // Mock key provider key retrieval
    mockRetrieveKeyProviderPrvKey = sinon.stub(keyProviderUtils, 'retrieveKeyProviderPrvKey');
    mockRetrieveKeyProviderPrvKey
      .withArgs({
        pub: 'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV',
        source: 'user',
        cfg: config,
      })
      .resolves(
        'xprv9s21ZrQH143K2ZbYmTE75wsdaTsiSgsajJnooSi1wBieWRwQ89xSBwAYK1VJR795Y8XFCCXYHHs4sk2Heg6dkX3CHMBq5bw8DwBWByWx883',
      );

    mockRetrieveKeyProviderPrvKey
      .withArgs({
        pub: 'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH',
        source: 'backup',
        cfg: config,
      })
      .resolves(
        'xprv9s21ZrQH143K2VroHDZPJsJUvrSnaW9vkZu6LFDMZviMT84z9tt58gSf25PzAMJC9pb1qRUBiYcsgcKWTDhwmwazsDAvzzDB5qrE3XDfawH',
      );

    // Create app after middleware is stubbed
    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should recover a UTXO wallet by signing with user and backup keys', async () => {
    const userPub =
      'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV';
    const backupPub =
      'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH';
    const bitgoPub =
      'xpub661MyMwAqRbcGcBurxn9ptqqKGmMhnKa8D7TeZkaWpfQNTeG4qKEJ67eb6Hy58kZBwPHqjUt5iApUwvFVk9ffQYaV42RRom2p7yU5bcCwpq';

    const unsignedSweepPrebuildTx = {
      txHex:
        '70736274ff01005e0100000001edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f4170279000000000001012ba00f00000000000022002008da4d49c618c6a00dc86a962f9c452dc0151653d2630470dcf8375a9f6496a501030401000000010569522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae22060222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e14502e31ca000000000000000014000000000000002206033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e9146700d77100000000000000001400000000000000220603a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae14c2d0eb0a000000000000000014000000000000000000',
      txInfo: {
        unspents: [
          {
            id: '3bc8f46fcbbc04e4b4a61f1a67a2cca381254524ca6d5e26bfaaf5fe83a5d7ed:0',
            address: 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu',
            value: 4000,
            chain: 20,
            index: 0,
            valueString: '4000',
          },
        ],
      },
      feeInfo: {},
      coin: 'tbtc',
    };

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx,
      walletContractAddress: '',
      coin,
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex');
    response.body.txHex.should.equal(
      '01000000000101edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f41702790400473044022043a9256810ef47ce36a092305c0b1ef675bce53e46418eea8cacbf1643e541d90220450766e048b841dac658d0a2ba992628bfe131dff078c3a574cadf67b4946647014730440220360045a15e459ed44aa3e52b86dd6a16dddaf319821f4dcc15627686f377edd102205cb3d5feab1a773c518d43422801e01dd1bc586bb09f6a9ed23a1fc0cfeeb5310169522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae00000000',
    );

    // Verify key provider key retrieval
    mockRetrieveKeyProviderPrvKey
      .calledWith({
        pub: userPub,
        source: 'user',
        cfg: config,
      })
      .should.be.true();
    mockRetrieveKeyProviderPrvKey
      .calledWith({
        pub: backupPub,
        source: 'backup',
        cfg: config,
      })
      .should.be.true();
  });
});

describe('UTXO recovery — external signing mode', () => {
  let agent: request.SuperAgentTest;

  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'tbtc';
  const userPub =
    'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV';
  const backupPub =
    'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH';
  const bitgoPub =
    'xpub661MyMwAqRbcGcBurxn9ptqqKGmMhnKa8D7TeZkaWpfQNTeG4qKEJ67eb6Hy58kZBwPHqjUt5iApUwvFVk9ffQYaV42RRom2p7yU5bcCwpq';
  const unsignedTxHex = '70736274ff01000000';
  const halfSignedTxHex = '70736274ff01000001';
  const fullSignedTxHex = '70736274ff01000002';

  const config: AdvancedWalletManagerConfig = {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    signingMode: SigningMode.EXTERNAL,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    tlsMode: TlsMode.DISABLED,
    clientCertAllowSelfSigned: true,
    keyProviderUrl,
    recoveryMode: true,
  };

  const utxoCoinStub = {
    getFamily: () => CoinFamily.BTC,
    getFullName: () => 'Test Bitcoin',
    isEVM: () => false,
  } as unknown as BaseCoin;

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const bitgo = new BitGo({ env: 'test', accessToken: 'test_token' });

    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<AdvancedWalletManagerConfig>).bitgo = bitgo;
      (req as BitGoRequest<AdvancedWalletManagerConfig>).config = config;
      next();
    });

    sinon.stub(coinFactory, 'getCoin').resolves(utxoCoinStub);

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should call POST /sign twice (user then backup) and not call retrieveKeyProviderPrvKey', async () => {
    const retrieveStub = sinon.stub(keyProviderUtils, 'retrieveKeyProviderPrvKey');

    const userSignNock = nock(keyProviderUrl)
      .post('/sign', {
        pub: userPub,
        source: 'user',
        signablePayload: unsignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: halfSignedTxHex });
    const backupSignNock = nock(keyProviderUrl)
      .post('/sign', {
        pub: backupPub,
        source: 'backup',
        signablePayload: halfSignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: fullSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '',
      coin,
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', fullSignedTxHex);
    userSignNock.done();
    backupSignNock.done();
    retrieveStub.called.should.equal(false);
  });

  it('should use half-signed PSBT from user sign as input to backup sign', async () => {
    nock(keyProviderUrl)
      .post('/sign', {
        pub: userPub,
        source: 'user',
        signablePayload: unsignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: halfSignedTxHex });
    // backup receives the half-signed PSBT (output of user sign), not the original unsigned one
    const backupNock = nock(keyProviderUrl)
      .post('/sign', {
        pub: backupPub,
        source: 'backup',
        signablePayload: halfSignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: fullSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '',
      coin,
    });

    response.status.should.equal(200);
    /** Verify backup sign call was made */
    backupNock.done();
  });

  it('surfaces key-provider signing failures as BitgoApiResponseError', async () => {
    nock(keyProviderUrl)
      .post('/sign', (body) => body.source === 'user')
      .reply(500, { message: 'HSM error' });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '',
      coin,
    });

    response.body.error.should.equal('BitGoApiResponseError');
    response.body.details.should.eql({ keySource: 'user' });
  });

  it('keyToSign=user: calls user key provider only and returns a half-signed tx', async () => {
    nock(keyProviderUrl)
      .post('/sign', {
        pub: userPub,
        source: 'user',
        signablePayload: unsignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: halfSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '',
      coin,
      keyToSign: 'user',
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', halfSignedTxHex);
    // Backup key provider must NOT be called
    nock.pendingMocks().should.have.length(0);
  });

  it('keyToSign=backup: calls backup key provider with half-signed tx and returns the full-signed tx', async () => {
    nock(keyProviderUrl)
      .post('/sign', {
        pub: backupPub,
        source: 'backup',
        signablePayload: halfSignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: fullSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '',
      coin,
      keyToSign: 'backup',
      halfSignedTransaction: { txHex: halfSignedTxHex },
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', fullSignedTxHex);
  });
});

describe('EVM recovery — external signing mode', () => {
  let agent: request.SuperAgentTest;

  const keyProviderUrl = 'http://key-provider.invalid';
  const coin = 'teth';
  const userPub =
    'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV';
  const backupPub =
    'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH';
  const bitgoPub =
    'xpub661MyMwAqRbcGcBurxn9ptqqKGmMhnKa8D7TeZkaWpfQNTeG4qKEJ67eb6Hy58kZBwPHqjUt5iApUwvFVk9ffQYaV42RRom2p7yU5bcCwpq';
  const unsignedTxHex = '0xunsigned';
  const halfSignedTxHex = '0xhalfsigned';
  const fullSignedTxHex = '0xfullsigned';

  const config: AdvancedWalletManagerConfig = {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    signingMode: SigningMode.EXTERNAL,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    tlsMode: TlsMode.DISABLED,
    clientCertAllowSelfSigned: true,
    keyProviderUrl,
    recoveryMode: true,
  };

  const evmCoinStub = {
    getFamily: () => CoinFamily.ETH,
    getFullName: () => 'Test Ethereum',
    isEVM: () => true,
  } as unknown as BaseCoin;

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const bitgo = new BitGo({ env: 'test', accessToken: 'test_token' });

    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<AdvancedWalletManagerConfig>).bitgo = bitgo;
      (req as BitGoRequest<AdvancedWalletManagerConfig>).config = config;
      next();
    });

    sinon.stub(coinFactory, 'getCoin').resolves(evmCoinStub);

    agent = request.agent(expressApp(config));
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('keyToSign=user: calls user key provider and returns a flat half-signed tx', async () => {
    const userSignNock = nock(keyProviderUrl)
      .post('/sign', {
        pub: userPub,
        source: 'user',
        signablePayload: unsignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: halfSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '0xcontract',
      coin,
      keyToSign: 'user',
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', halfSignedTxHex);
    userSignNock.done();
  });

  it('keyToSign=backup with a rich EVM half-signed object (no top-level txHex): returns 400', async () => {
    // No key-provider nock: the guard must reject before any sign call.
    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '0xcontract',
      coin,
      keyToSign: 'backup',
      halfSignedTransaction: { halfSigned: { txHex: halfSignedTxHex } },
    });

    response.status.should.equal(400);
    response.body.details.should.containEql('External backup signing for EVM coins');
    nock.pendingMocks().should.have.length(0);
  });

  it('keyToSign=backup with a flat halfSignedTransaction.txHex: calls backup key provider', async () => {
    const backupSignNock = nock(keyProviderUrl)
      .post('/sign', {
        pub: backupPub,
        source: 'backup',
        signablePayload: halfSignedTxHex,
        algorithm: 'ecdsa',
      })
      .reply(200, { signature: fullSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { txHex: unsignedTxHex },
      walletContractAddress: '0xcontract',
      coin,
      keyToSign: 'backup',
      halfSignedTransaction: { txHex: halfSignedTxHex },
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', fullSignedTxHex);
    backupSignNock.done();
  });
});

describe('UTXO recovery — local signing with keyToSign', () => {
  let agent: request.SuperAgentTest;
  let signTransactionStub: sinon.SinonStub;

  const coin = 'tbtc';
  const userPub =
    'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV';
  const backupPub =
    'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH';
  const bitgoPub =
    'xpub661MyMwAqRbcGcBurxn9ptqqKGmMhnKa8D7TeZkaWpfQNTeG4qKEJ67eb6Hy58kZBwPHqjUt5iApUwvFVk9ffQYaV42RRom2p7yU5bcCwpq';
  const userPrv =
    'xprv9s21ZrQH143K2ZbYmTE75wsdaTsiSgsajJnooSi1wBieWRwQ89xSBwAYK1VJR795Y8XFCCXYHHs4sk2Heg6dkX3CHMBq5bw8DwBWByWx883';
  const backupPrv =
    'xprv9s21ZrQH143K2VroHDZPJsJUvrSnaW9vkZu6LFDMZviMT84z9tt58gSf25PzAMJC9pb1qRUBiYcsgcKWTDhwmwazsDAvzzDB5qrE3XDfawH';
  const halfSignedTxHex = 'half-signed-utxo-tx-hex';
  const fullSignedTxHex = 'full-signed-utxo-tx-hex';
  const unsignedSweepPrebuildTx = {
    txHex:
      '70736274ff01005e0100000001edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f4170279000000000001012ba00f00000000000022002008da4d49c618c6a00dc86a962f9c452dc0151653d2630470dcf8375a9f6496a5',
    txInfo: { unspents: [{ id: 'deadbeef:0', address: 'tb1q...', value: 4000 }] },
    feeInfo: {},
    coin: 'tbtc',
  };

  const config: AdvancedWalletManagerConfig = {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    signingMode: SigningMode.LOCAL,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    tlsMode: TlsMode.DISABLED,
    clientCertAllowSelfSigned: true,
    keyProviderUrl: 'key-provider.example.com',
    recoveryMode: true,
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const bitgo = new BitGo({ env: 'test', accessToken: 'test_token' });

    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<AdvancedWalletManagerConfig>).bitgo = bitgo;
      (req as BitGoRequest<AdvancedWalletManagerConfig>).config = config;
      next();
    });

    signTransactionStub = sinon.stub();
    const utxoCoinStub = {
      getFamily: () => CoinFamily.BTC,
      isEVM: () => false,
      signTransaction: signTransactionStub,
    } as unknown as BaseCoin;
    sinon.stub(coinFactory, 'getCoin').resolves(utxoCoinStub);

    const retrieveStub = sinon.stub(keyProviderUtils, 'retrieveKeyProviderPrvKey');
    retrieveStub.withArgs({ pub: userPub, source: 'user', cfg: config }).resolves(userPrv);
    retrieveStub.withArgs({ pub: backupPub, source: 'backup', cfg: config }).resolves(backupPrv);

    agent = request.agent(expressApp(config));
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('keyToSign=user: fetches only user prv and returns half-signed tx', async () => {
    signTransactionStub.resolves({ txHex: halfSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx,
      walletContractAddress: '',
      coin,
      keyToSign: 'user',
    });

    response.status.should.equal(200);
    response.body.txHex.should.equal(halfSignedTxHex);
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'user' }))
      .should.be.true();
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'backup' }))
      .should.be.false();
    signTransactionStub.calledWith(sinon.match({ isLastSignature: false })).should.be.true();
  });

  it('keyToSign=backup: fetches only backup prv and signs with halfSignedTransaction.txHex', async () => {
    signTransactionStub.resolves({ txHex: fullSignedTxHex });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx,
      walletContractAddress: '',
      coin,
      keyToSign: 'backup',
      halfSignedTransaction: { txHex: halfSignedTxHex },
    });

    response.status.should.equal(200);
    response.body.txHex.should.equal(fullSignedTxHex);
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'backup' }))
      .should.be.true();
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'user' }))
      .should.be.false();
    signTransactionStub
      .calledWith(
        sinon.match({
          isLastSignature: true,
          txPrebuild: sinon.match({ txHex: halfSignedTxHex }),
        }),
      )
      .should.be.true();
  });

  it('keyToSign=backup without halfSignedTransaction: returns 400', async () => {
    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx,
      walletContractAddress: '',
      coin,
      keyToSign: 'backup',
      // halfSignedTransaction deliberately omitted
    });

    response.status.should.equal(400);
    response.body.details.should.containEql('halfSignedTransaction is required');
  });
});

describe('EVM recovery — local signing with keyToSign (two-phase)', () => {
  let agent: request.SuperAgentTest;
  let signTransactionStub: sinon.SinonStub;

  const coin = 'teth';
  const userPub =
    'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV';
  const backupPub =
    'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH';
  const bitgoPub =
    'xpub661MyMwAqRbcGcBurxn9ptqqKGmMhnKa8D7TeZkaWpfQNTeG4qKEJ67eb6Hy58kZBwPHqjUt5iApUwvFVk9ffQYaV42RRom2p7yU5bcCwpq';
  const userPrv =
    'xprv9s21ZrQH143K2ZbYmTE75wsdaTsiSgsajJnooSi1wBieWRwQ89xSBwAYK1VJR795Y8XFCCXYHHs4sk2Heg6dkX3CHMBq5bw8DwBWByWx883';
  const backupPrv =
    'xprv9s21ZrQH143K2VroHDZPJsJUvrSnaW9vkZu6LFDMZviMT84z9tt58gSf25PzAMJC9pb1qRUBiYcsgcKWTDhwmwazsDAvzzDB5qrE3XDfawH';
  const halfSignedTxHex = 'half-signed-evm-tx-hex';
  const fullSignedTxHex = 'full-signed-evm-tx-hex';
  const recipients = [{ address: '0xrecipient', amount: '1000' }];

  const config: AdvancedWalletManagerConfig = {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    signingMode: SigningMode.LOCAL,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    tlsMode: TlsMode.DISABLED,
    clientCertAllowSelfSigned: true,
    keyProviderUrl: 'key-provider.example.com',
    recoveryMode: true,
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const bitgo = new BitGo({ env: 'test', accessToken: 'test_token' });

    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<AdvancedWalletManagerConfig>).bitgo = bitgo;
      (req as BitGoRequest<AdvancedWalletManagerConfig>).config = config;
      next();
    });

    signTransactionStub = sinon.stub();
    const evmCoinStub = {
      getFamily: () => CoinFamily.ETH,
      isEVM: () => true,
      signTransaction: signTransactionStub,
    } as unknown as BaseCoin;
    sinon.stub(coinFactory, 'getCoin').resolves(evmCoinStub);

    const retrieveStub = sinon.stub(keyProviderUtils, 'retrieveKeyProviderPrvKey');
    retrieveStub.withArgs({ pub: userPub, source: 'user', cfg: config }).resolves(userPrv);
    retrieveStub.withArgs({ pub: backupPub, source: 'backup', cfg: config }).resolves(backupPrv);

    agent = request.agent(expressApp(config));
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('keyToSign=user: returns a rich EVM half-signed tx (with halfSigned object)', async () => {
    signTransactionStub.resolves({
      halfSigned: {
        txHex: halfSignedTxHex,
        recipients,
        expireTime: 123,
        backupKeyNonce: 1,
        signature: '0xsig',
      },
    });

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { recipients, nextContractSequenceId: 1 },
      walletContractAddress: '0xcontract',
      coin,
      keyToSign: 'user',
    });

    response.status.should.equal(200);
    response.body.should.have.property('halfSigned');
    response.body.halfSigned.should.have.property('txHex', halfSignedTxHex);
    response.body.halfSigned.should.have.property('recipients');
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'user' }))
      .should.be.true();
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'backup' }))
      .should.be.false();
    signTransactionStub.calledWith(sinon.match({ isLastSignature: false })).should.be.true();
  });

  it('keyToSign=backup: consumes the rich EVM half-signed tx and returns the full-signed tx', async () => {
    signTransactionStub.resolves({ txHex: fullSignedTxHex });

    const halfSignedTransaction = {
      halfSigned: {
        txHex: halfSignedTxHex,
        recipients,
        expireTime: 123,
        backupKeyNonce: 1,
      },
      recipients,
    };

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { recipients, nextContractSequenceId: 1 },
      walletContractAddress: '0xcontract',
      coin,
      keyToSign: 'backup',
      halfSignedTransaction,
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex', fullSignedTxHex);
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'backup' }))
      .should.be.true();
    (keyProviderUtils.retrieveKeyProviderPrvKey as sinon.SinonStub)
      .calledWith(sinon.match({ source: 'user' }))
      .should.be.false();
    signTransactionStub.calledWith(sinon.match({ isLastSignature: true })).should.be.true();
    signTransactionStub
      .calledWith(
        sinon.match({
          txPrebuild: sinon.match({
            txHex: halfSignedTxHex,
            halfSigned: halfSignedTransaction.halfSigned,
          }),
        }),
      )
      .should.be.true();
  });

  it('keyToSign=backup with a malformed EVM half-signed tx (no halfSigned.txHex): returns 400', async () => {
    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx: { recipients, nextContractSequenceId: 1 },
      walletContractAddress: '0xcontract',
      coin,
      keyToSign: 'backup',
      halfSignedTransaction: { halfSigned: {} },
    });

    response.status.should.equal(400);
    response.body.details.should.containEql('EVM half-signed recovery tx');
    signTransactionStub.called.should.be.false();
  });
});
