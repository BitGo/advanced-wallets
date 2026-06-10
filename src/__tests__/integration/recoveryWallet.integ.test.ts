import 'should';
import nock from 'nock';
import signFixture from './fixtures/keyProvider/sign.json';
import { startServices, IntegServices } from './helpers/setup';
import { LOCALHOST } from './helpers/servers';
import { setupIndexerMocks, teardownIndexerMocks } from './helpers/mockIndexerServer';
import { SigningMode } from '../../shared/types';

/**
 * Deterministic test keypairs derived from Buffer.alloc(64, 0x11/0x22/0x33).
 * Not secrets. Never funded.
 */
const USER_XPUB =
  'xpub661MyMwAqRbcG6vAfdAptEwUcELwQDcsPnBtAJoPSKc8nQC7QniowQJq5iLHFWxrPX11bjBzohqh7isG6rgqBdMa7hPCUekfc6XbER5AH4A';
const USER_XPRV =
  'xprv9s21ZrQH143K3cqhZbdpX6zk4CWSzku22ZGHMvPmsz59ubrxsFQZPbzMESXYNBC1xkjtLfcfE6nDHHqwuxtiDD2LUjxrJ642wbV1LptE2TY';
const BACKUP_XPUB =
  'xpub661MyMwAqRbcFnihegj1Mo2ePZoMQyLbBYpW7gDXZ7qzqxF3FBAkNAP8Gki8Mxx2BVLjN3RRa75pt5apD2g3ewXPrCfdssAJ7VupXqucLsb';
const BACKUP_XPRV =
  'xprv9s21ZrQH143K3JeEYfBzzf5uqXxs1WcjpKtuKHouznK1y9uthdrVpN4eRT6DazfjqrUzt4Sgb3CJoYMov84hCupCxUpR5AKEgCcqwsEw8D7';
const BITGO_XPUB =
  'xpub661MyMwAqRbcGzf9nbW39NHXwK34zP3q2ZxcwKv1A29u2fdkZJLG8tfuthR5YL91p85QECEJBK1oTs2fmeToKuiSBBLMDi49wYh1SzSQ1WN';

const ADDR_WITH_FUNDS = 'tb1qjtxnrfcjkhwtghy2nphshch688zzepmnj2927nlazfc77xcnax0qlwp3je';
const MOCK_UTXO_TX_HASH = '3bc8f46fcbbc04e4b4a61f1a67a2cca381254524ca6d5e26bfaaf5fe83a5d7ed';
const MOCK_UTXO_VALUE = 4000;

const KP_SIGN_FIXTURE = signFixture.signature;
const BLOCKCHAIR_API_KEY = 'test-key';

const recoveryRequestBody = {
  multiSigRecoveryParams: {
    userPub: USER_XPUB,
    backupPub: BACKUP_XPUB,
    bitgoPub: BITGO_XPUB,
    walletContractAddress: '',
  },
  recoveryDestinationAddress: 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu',
  coin: 'tbtc',
  apiKey: BLOCKCHAIR_API_KEY,
  coinSpecificParams: {
    utxoRecoveryOptions: {
      scan: 1,
    },
  },
};

interface RecoveryResponse {
  txHex: string;
}

interface SignCallBody {
  pub: string;
  source: string;
  signablePayload: string;
  algorithm: string;
}

interface KeyBody {
  pub: string;
  prv: string;
  coin: string;
  source: string;
  type: string;
}

describe('Recovery wallet: EXTERNAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.EXTERNAL, recoveryMode: true });
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  after(async () => {
    teardownIndexerMocks();
    nock.enableNetConnect();
    await services.teardown();
  });

  beforeEach(() => {
    services.keyProvider.calls.length = 0;
    services.bitgo.calls.length = 0;
  });

  afterEach(() => {
    teardownIndexerMocks();
  });

  it('recovers tbtc via external key provider, calling AWM multisig/recovery', async () => {
    const indexer = setupIndexerMocks({
      fundsAddress: ADDR_WITH_FUNDS,
      txHash: MOCK_UTXO_TX_HASH,
      value: MOCK_UTXO_VALUE,
      apiKey: BLOCKCHAIR_API_KEY,
    });

    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/recovery`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(recoveryRequestBody),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as RecoveryResponse;
    body.should.have.property('txHex');

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(0);
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send')).should.have.length(0);
    services.bitgo.calls
      .filter((c) => c.path.endsWith('/consolidateUnspents'))
      .should.have.length(0);

    const signCalls = services.keyProvider.calls.filter((c) => c.path === '/sign');
    signCalls.should.have.length(2);

    const userSignBody = signCalls[0].body as SignCallBody;
    userSignBody.should.have.property('pub', USER_XPUB);
    userSignBody.should.have.property('source', 'user');
    userSignBody.should.have.property('algorithm', 'ecdsa');
    userSignBody.signablePayload.should.startWith('70736274ff');

    const backupSignBody = signCalls[1].body as SignCallBody;
    backupSignBody.should.have.property('pub', BACKUP_XPUB);
    backupSignBody.should.have.property('source', 'backup');
    backupSignBody.should.have.property('algorithm', 'ecdsa');
    backupSignBody.should.have.property('signablePayload', KP_SIGN_FIXTURE);

    services.keyProvider.calls.filter((c) => c.path === '/key').should.have.length(0);
    services.keyProvider.calls.filter((c) => c.path.startsWith('/key/')).should.have.length(0);

    body.txHex.should.equal(KP_SIGN_FIXTURE);

    indexer.fundsBalanceDone().should.be.true();
    indexer.unspentsDone().should.be.true();
    indexer.feeDone().should.be.true();
  });
});

describe('Recovery wallet: LOCAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.LOCAL, recoveryMode: true });

    await fetch(`http://127.0.0.1:${services.keyProvider.port}/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pub: USER_XPUB,
        prv: USER_XPRV,
        coin: 'tbtc',
        source: 'user',
        type: 'independent',
      } satisfies KeyBody),
    });

    await fetch(`http://127.0.0.1:${services.keyProvider.port}/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pub: BACKUP_XPUB,
        prv: BACKUP_XPRV,
        coin: 'tbtc',
        source: 'backup',
        type: 'independent',
      } satisfies KeyBody),
    });

    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  after(async () => {
    teardownIndexerMocks();
    nock.enableNetConnect();
    await services.teardown();
  });

  beforeEach(() => {
    services.keyProvider.calls.length = 0;
    services.bitgo.calls.length = 0;
  });

  afterEach(() => {
    teardownIndexerMocks();
  });

  it('recovers tbtc using locally stored xprvs, calling AWM multisig/recovery', async () => {
    const indexer = setupIndexerMocks({
      fundsAddress: ADDR_WITH_FUNDS,
      txHash: MOCK_UTXO_TX_HASH,
      value: MOCK_UTXO_VALUE,
      apiKey: BLOCKCHAIR_API_KEY,
    });

    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/recovery`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(recoveryRequestBody),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as RecoveryResponse;
    body.should.have.property('txHex');
    body.txHex.should.match(/^(01000000|02000000)/);

    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/build')).should.have.length(0);
    services.bitgo.calls.filter((c) => c.path.endsWith('/tx/send')).should.have.length(0);
    services.bitgo.calls
      .filter((c) => c.path.endsWith('/consolidateUnspents'))
      .should.have.length(0);

    services.keyProvider.calls.filter((c) => c.path === '/sign').should.have.length(0);

    const keyLookups = services.keyProvider.calls.filter((c) => c.path.startsWith('/key/'));
    keyLookups.should.have.length(2);
    const lookedUpPubs = keyLookups.map((c) => c.path.replace('/key/', ''));
    lookedUpPubs.should.containEql(USER_XPUB);
    lookedUpPubs.should.containEql(BACKUP_XPUB);

    indexer.fundsBalanceDone().should.be.true();
    indexer.unspentsDone().should.be.true();
    indexer.feeDone().should.be.true();
  });
});
