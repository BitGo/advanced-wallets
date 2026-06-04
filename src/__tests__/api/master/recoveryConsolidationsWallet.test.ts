import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Trx } from '@bitgo-beta/sdk-coin-trx';
import { BitGoAPITestHarness } from './testUtils';

describe('POST /api/v1/:coin/advancedwallet/recoveryconsolidations', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'https://test-advanced-wallet-manager.com';
  const accessToken = 'test-access-token';

  const mockUserPub =
    'xpub661MyMwAqRbcEtjU21VjQhGDdg5noG6kCGjcpc4EZwnLUxr9Pi56i14Eek8CQqcuGVnXQf3Zy47Uizr5WHDbZ3GumXEFXpwFLHWGbKrWWcg';
  const mockBackupPub =
    'xpub661MyMwAqRbcEnTrcp222pRm7G1ZAbDD3KxXT2XEKRe3jnnvydqnyssewd2eUxgeWr1c1ffHcqqRKB8j3Lw9VR4dvrAhTov4kPKZF5rs6Vr';
  const mockBitgoPub =
    'xpub661MyMwAqRbcFNUFGFmDcC3Frgtz4FnJqFdCGbzLva2hf5i3ZJuQdsGc3z5FXCVqR9NQ6h2zTyGcQkfFtsLT5St621Fcu1C22kCKhbo4kQy';

  // ── SOL-specific constants ────────────────────────────────────────────────

  const solRpcBase = 'https://api.devnet.solana.com';

  const solBitgoKey =
    '125746de1919236bd30a4809d718b1c161ab8f7674fe506bed438fa860adcfcc' +
    '256f3721062dfeaea177c38c467a24228b9acf1a9f92fc2f5d0177bbbf218eb8';

  const solWalletAddress2 = '22USpDwmubAoY5uws4hp4YhJZwt4eoumeLrGGx5z7DWV';

  const solDurableNoncePubKey = '6LqY5ncj7s4b1c3YJV1hsn2hVPNhEfvDCNYMaCc1jJhX';
  const solDurableNoncePubKey2 = '4Y3kQtmVUfF7nimtABPpCwjihmLgJUgm8eZTAo44c4u9';
  const solDurableNoncePubKey3 = '6UW2N7eynvw1zjULpGDxPorJHj6wpvVgiFUcjzwoY6fg';
  const solDurableNoncePrivKey =
    '447272d65cc8b39f88ea23b5f16859bd84b3ecfd6176ef99535efab37541c83b' +
    '051a34bc8acd438763976f96876115050f73828553566d111d7ac8bffebf587c';

  const solDurableNonceAccountInfo = {
    jsonrpc: '2.0',
    result: {
      context: { apiVersion: '1.10.39', slot: 163846900 },
      value: {
        data: {
          parsed: {
            info: {
              authority: 'LvDUy1MovMeusYaL8ErQAqL4PeD8H9W1RALJU3twUGj',
              blockhash: 'MeM29wJ8Kai1SyV5Xz8fHQhTygPs4Eka7UTgZH3LsEm',
              feeCalculator: { lamportsPerSignature: '5000' },
            },
            type: 'initialized',
          },
          program: 'nonce',
          space: 80,
        },
        executable: false,
        lamports: 1447680,
        owner: '11111111111111111111111111111111',
        rentEpoch: 0,
      },
    },
    id: 1,
  };

  // ── SUI-specific constants ────────────────────────────────────────────────

  const suiRpcBase = 'https://fullnode.testnet.sui.io';

  const suiBitgoKey =
    '3b89eec9d2d2f3b049ecda2e7b5f47827f7927fe6618d6e8b13f64e7c95f4b0' +
    '0b9577ab01395ecf8eeb804b590cedae14ff5fd3947bf3b7a95b9327c49e27c54';

  const suiReceiveAddress1 = '0x32d8e57ee6d91e5558da0677154c2f085795348e317f95acc9efade1b4112fcc';

  const suiCoinsAtAddr1 = [
    {
      coinType: '0x2::sui::SUI',
      coinObjectId: '0x996aab365d4551b6d1274f520bbfa7b0a566d548b2d590b5565c623812e7e76d',
      version: '201',
      digest: 'HXpNTfx9TBdxFcXHi4RziZsQuDAHavRasK6Ri15rVwuA',
      balance: '200000000',
    },
    {
      coinType: '0x2::sui::SUI',
      coinObjectId: '0xb39c5f380208cce7fe1ba1258c8d19befb02a80f14952617ed37098dbd4d2df0',
      version: '199',
      digest: 'mqk37hXLkiUYgkYxk2MyqNykCkCXwe97uMus7bDPhe2',
      balance: '101976',
    },
  ];

  // ── TRX-specific constants ────────────────────────────────────────────────

  const trxTokenContractAddress = 'TARsLWnWXyxDLzXpZLt8PKQjx7kqcPkbDx';

  const tronBase = 'https://api.shasta.trongrid.io';

  const TRX_ADDR_1 = 'TGAsEaxULesgHpKw39zrf4pWg3pbYTTKx8';
  const TRX_ADDR_2 = 'TWWPHrDJUVJMv21hkjkLP3ksVctpLDHpce';
  const TRX_ADDR_3 = 'TGp8qBtnJkhK1xRtuSgW5cgus9bADDXwUL';

  // A minimal structurally-valid TRON transaction taken from the SDK's own test fixtures
  const TRON_MOCK_TX = {
    visible: false,
    txID: 'ee0bbf72b238361577a9dc41d79f7a74f6ba9efe472c21bfd3e7dc850c9e9020',
    raw_data: {
      contract: [
        {
          parameter: {
            value: {
              amount: 10,
              owner_address: '41e5e00fc1cdb3921b8340c20b2b65b543c84aa1dd',
              to_address: '412c2ba4a9ff6c53207dc5b686bfecf75ea7b80577',
            },
            type_url: 'type.googleapis.com/protocol.TransferContract',
          },
          type: 'TransferContract',
        },
      ],
      ref_block_bytes: '5123',
      ref_block_hash: '52a26dea963a47bc',
      expiration: 1569463320000,
      timestamp: 1569463261623,
    },
    raw_data_hex:
      '0a025123220852a26dea963a47bc40c0fbb6dad62d5a65080112610a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412300a1541e5e00fc1cdb3921b8340c20b2b65b543c84aa1dd1215412c2ba4a9ff6c53207dc5b686bfecf75ea7b80577180a70b7b3b3dad62d',
  };

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: advancedWalletManagerUrl,
      awmServerCaCert: 'test-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      recoveryMode: true,
    };
    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    BitGoAPITestHarness.clearConstantsCache();
  });

  it('should succeed in handling TRON consolidation recovery for onchain wallet', async () => {
    const tronBalanceWithToken = {
      data: [
        {
          balance: 200_000_000,
          trc20: [{ [trxTokenContractAddress]: '1000000' }],
        },
      ],
    };

    const balanceNock1 = nock(tronBase)
      .get(`/v1/accounts/${TRX_ADDR_1}`)
      .reply(200, tronBalanceWithToken);
    const triggerNock1 = nock(tronBase)
      .post('/wallet/triggersmartcontract')
      .reply(200, { transaction: TRON_MOCK_TX });

    const balanceNock2 = nock(tronBase)
      .get(`/v1/accounts/${TRX_ADDR_2}`)
      .reply(200, tronBalanceWithToken);
    const triggerNock2 = nock(tronBase)
      .post('/wallet/triggersmartcontract')
      .reply(200, { transaction: TRON_MOCK_TX });

    const recoveryNock = nock(advancedWalletManagerUrl)
      .post('/api/trx/multisig/recovery')
      .twice()
      .reply(200, { txHex: 'signed-tx' });

    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain' as const,
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
        tokenContractAddress: trxTokenContractAddress,
        startingScanIndex: 1,
        endingScanIndex: 3,
      });

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(2);

    balanceNock1.isDone().should.be.true();
    triggerNock1.isDone().should.be.true();
    balanceNock2.isDone().should.be.true();
    triggerNock2.isDone().should.be.true();
    recoveryNock.done();
  });

  it('should succeed in handling Solana consolidation recovery for onchain wallet', async () => {
    // Uses real SOL SDK fixture keys so Sol.recoverConsolidations runs end-to-end.
    nock(solRpcBase)
      .post('/', (b) => b.method === 'getBalance' && b.params[0] === solWalletAddress2)
      .reply(200, { jsonrpc: '2.0', result: { context: { slot: 1 }, value: 1000000000 }, id: 1 });

    nock(solRpcBase)
      .post('/', (b) => b.method === 'getLatestBlockhash')
      .reply(200, {
        jsonrpc: '2.0',
        result: {
          context: { slot: 2792 },
          value: {
            blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
            lastValidBlockHeight: 3090,
          },
        },
        id: 1,
      });

    nock(solRpcBase)
      .post('/', (b) => b.method === 'getAccountInfo' && b.params[0] === solDurableNoncePubKey)
      .reply(200, solDurableNonceAccountInfo);

    nock(solRpcBase)
      .post('/', (b) => b.method === 'getFeeForMessage')
      .reply(200, { jsonrpc: '2.0', result: { context: { slot: 1 }, value: 5000 }, id: 1 });

    const recoveryNock = nock(advancedWalletManagerUrl)
      .post('/api/sol/multisig/recovery')
      .reply(200, { txHex: 'signed-tx' });

    const response = await agent
      .post(`/api/v1/sol/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain' as const,
        userPub: solBitgoKey,
        backupPub: solBitgoKey,
        bitgoPub: solBitgoKey,
        startingScanIndex: 2,
        endingScanIndex: 3,
        durableNonces: {
          publicKeys: [solDurableNoncePubKey, solDurableNoncePubKey2, solDurableNoncePubKey3],
          secretKey: solDurableNoncePrivKey,
        },
      });

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(1);
    recoveryNock.done();
  });

  it('should succeed in handling MPC consolidation recovery with commonKeychain', async () => {
    // Uses real SUI SDK fixture keys so Sui.recoverConsolidations runs end-to-end.
    nock(suiRpcBase)
      .post('/', (b) => b.method === 'suix_getBalance' && b.params[0] === suiReceiveAddress1)
      .reply(200, { result: { totalBalance: '200101976', fundsInAddressBalance: '0' } });

    nock(suiRpcBase)
      .post('/', (b) => b.method === 'suix_getCoins' && b.params[0] === suiReceiveAddress1)
      .reply(200, {
        result: { data: suiCoinsAtAddr1, hasNextPage: false, nextCursor: null },
      });

    nock(suiRpcBase)
      .post('/', (b) => b.method === 'sui_dryRunTransactionBlock')
      .reply(200, {
        result: {
          effects: {
            status: { status: 'success' },
            gasUsed: {
              computationCost: '1000000',
              storageCost: '976000',
              storageRebate: '978120',
              nonRefundableStorageFee: '9880',
            },
          },
        },
      });

    let capturedAwmBody: any;
    const recoveryNock = nock(advancedWalletManagerUrl)
      .post('/api/tsui/mpc/recovery', (body) => {
        capturedAwmBody = body;
        return true;
      })
      .reply(200, { txHex: 'signed-mpc-tx' });

    const response = await agent
      .post(`/api/v1/tsui/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'tss' as const,
        commonKeychain: suiBitgoKey,
        startingScanIndex: 1,
        endingScanIndex: 2,
      });

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(1);
    recoveryNock.done();
    capturedAwmBody.should.have.property('commonKeychain', suiBitgoKey);
  });

  it('should succeed in handling SOL MPC consolidation recovery', async () => {
    // Uses real SOL SDK fixture keys so Sol.recoverConsolidations runs end-to-end.
    nock(solRpcBase)
      .post('/', (b) => b.method === 'getBalance' && b.params[0] === solWalletAddress2)
      .reply(200, { jsonrpc: '2.0', result: { context: { slot: 1 }, value: 1000000000 }, id: 1 });

    nock(solRpcBase)
      .post('/', (b) => b.method === 'getLatestBlockhash')
      .reply(200, {
        jsonrpc: '2.0',
        result: {
          context: { slot: 2792 },
          value: {
            blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
            lastValidBlockHeight: 3090,
          },
        },
        id: 1,
      });

    nock(solRpcBase)
      .post('/', (b) => b.method === 'getAccountInfo' && b.params[0] === solDurableNoncePubKey)
      .reply(200, solDurableNonceAccountInfo);

    nock(solRpcBase)
      .post('/', (b) => b.method === 'getFeeForMessage')
      .reply(200, { jsonrpc: '2.0', result: { context: { slot: 1 }, value: 5000 }, id: 1 });

    let capturedAwmBody: any;
    const recoveryNock = nock(advancedWalletManagerUrl)
      .post('/api/sol/mpc/recovery', (body) => {
        capturedAwmBody = body;
        return true;
      })
      .reply(200, { txHex: 'signed-mpc-tx' });

    const response = await agent
      .post(`/api/v1/sol/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'tss' as const,
        commonKeychain: solBitgoKey,
        startingScanIndex: 2,
        endingScanIndex: 3,
        durableNonces: {
          publicKeys: [solDurableNoncePubKey, solDurableNoncePubKey2, solDurableNoncePubKey3],
          secretKey: solDurableNoncePrivKey,
        },
      });

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(1);
    recoveryNock.done();
    capturedAwmBody.should.have.property('commonKeychain', solBitgoKey);
  });

  it('should succeed in handling multiple recovery consolidations', async () => {
    // Scan range: startingScanIndex=0 (falsy → defaults to 1), endingScanIndex=10
    // → scans indices 1-9.  Indices 1-3 have funds; 4-9 return empty data (no balance).
    const tronNativeBalance = { data: [{ balance: 10_000_000 }] };

    const balanceNock1 = nock(tronBase)
      .get(`/v1/accounts/${TRX_ADDR_1}`)
      .reply(200, tronNativeBalance);
    const createTxNock1 = nock(tronBase).post('/wallet/createtransaction').reply(200, TRON_MOCK_TX);

    const balanceNock2 = nock(tronBase)
      .get(`/v1/accounts/${TRX_ADDR_2}`)
      .reply(200, tronNativeBalance);
    const createTxNock2 = nock(tronBase).post('/wallet/createtransaction').reply(200, TRON_MOCK_TX);

    const balanceNock3 = nock(tronBase)
      .get(`/v1/accounts/${TRX_ADDR_3}`)
      .reply(200, tronNativeBalance);
    const createTxNock3 = nock(tronBase).post('/wallet/createtransaction').reply(200, TRON_MOCK_TX);

    // Indices 4-9 return no balance – use a persistent regex nock consumed by remaining calls
    nock(tronBase)
      .persist()
      .get(/\/v1\/accounts\/T.*/)
      .reply(200, { data: [] });

    const recoveryNock = nock(advancedWalletManagerUrl)
      .post('/api/trx/multisig/recovery')
      .thrice()
      .reply(200, { txHex: 'signed-tx' });

    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain' as const,
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
        startingScanIndex: 0,
        endingScanIndex: 10,
      });

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(3);

    balanceNock1.isDone().should.be.true();
    createTxNock1.isDone().should.be.true();
    balanceNock2.isDone().should.be.true();
    createTxNock2.isDone().should.be.true();
    balanceNock3.isDone().should.be.true();
    createTxNock3.isDone().should.be.true();
    recoveryNock.done();
  });

  it('should fail when commonKeychain is missing for MPC wallet', async () => {
    const response = await agent
      .post(`/api/v1/tsui/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'tss',
        apiKey: 'test-api-key',
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details', 'Missing required key: commonKeychain');
  });

  it('should fail when required keys are missing for onchain wallet', async () => {
    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property(
      'details',
      'Missing required keys: userPub, backupPub, bitgoPub',
    );
  });

  it('should fail when required multisigType parameter is missing', async () => {
    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when multisigType parameter has invalid value', async () => {
    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'invalid_type',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });

  it('should fail when authorization header is missing', async () => {
    const response = await agent.post(`/api/v1/trx/advancedwallet/recoveryconsolidations`).send({
      multisigType: 'onchain',
      userPub: mockUserPub,
      backupPub: mockBackupPub,
      bitgoPub: mockBitgoPub,
    });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should succeed in handling empty recovery consolidations result', async () => {
    // All scanned addresses return no balance → recoverConsolidations returns { transactions: [] }
    // Scan range: 1-20 (defaults). Regex nock handles all 20 balance lookups.
    nock(tronBase)
      .persist()
      .get(/\/v1\/accounts\/T.*/)
      .reply(200, { data: [] });

    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(0);
  });

  it('should fail when recoverConsolidations returns unexpected result structure', async () => {
    // This test verifies the handler's defensive check:
    //   if (!result.transactions && !result.txRequests) throw 'recoverConsolidations did not …'
    // The real SDK always returns one of those two shapes; this prototype stub exercises this error path
    const recoverConsolidationsStub = sinon.stub(Trx.prototype, 'recoverConsolidations').resolves({
      someOtherProperty: 'value',
    } as any);

    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property(
      'details',
      'recoverConsolidations did not return expected transactions',
    );

    sinon.assert.calledOnce(recoverConsolidationsStub);
  });

  it('should fail when recoverConsolidations throws an error', async () => {
    nock(tronBase)
      .get(/\/v1\/accounts\/T.*/)
      .reply(500, { error: 'Node error' });

    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when awmClient throws an error', async () => {
    // Index 1 has a recoverable balance; the AWM signing endpoint returns 500.
    nock(tronBase)
      .get(`/v1/accounts/${TRX_ADDR_1}`)
      .reply(200, { data: [{ balance: 10_000_000 }] });
    nock(tronBase).post('/wallet/createtransaction').reply(200, TRON_MOCK_TX);
    // Remaining indices in default scan (2-20) return no balance.
    nock(tronBase)
      .persist()
      .get(/\/v1\/accounts\/T.*/)
      .reply(200, { data: [] });

    nock(advancedWalletManagerUrl).post('/api/trx/multisig/recovery').reply(500, {
      error: 'Internal Server Error',
      details: 'Advanced Wallet Manager signing failed',
    });

    const response = await agent
      .post(`/api/v1/trx/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details');
  });

  it('should fail when durableNonces parameter is not correctly structured', async () => {
    const response = await agent
      .post(`/api/v1/sol/advancedwallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
        durableNonces: 'invalid-structure',
      });

    response.status.should.equal(400);
    response.body.should.have.property('error');
  });
});
