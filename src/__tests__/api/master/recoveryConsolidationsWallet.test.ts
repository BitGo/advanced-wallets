import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Trx } from '@bitgo-beta/sdk-coin-trx';
import { Sol } from '@bitgo-beta/sdk-coin-sol';
import { Sui } from '@bitgo-beta/sdk-coin-sui';
import { AdvancedWalletManagerClient } from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';

describe('POST /api/:coin/wallet/recoveryconsolidations', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'https://test-advanced-wallet-manager.com';
  const accessToken = 'test-access-token';

  const mockUserPub =
    'xpub661MyMwAqRbcFkPHucMnrGNzDwb6teAX1RbKQmqtEF8kK3Z7LZ59qafCjB9eCWzSgHCZkdXgp';
  const mockBackupPub =
    'xpub661MyMwAqRbcGaZrYqfYmaTRzQxM9PKEZ7GRb6DKfghkzgjk2dKT4qBXfz6WzpT4N5fXJhFW';
  const mockBitgoPub =
    'xpub661MyMwAqRbcF1cvdJUvQ8MV6a7R5hF5cBmVxA1zS1k7RH7NKj3X7K8fgR4kS2qY6jW9cF7L';
  const mockCommonKeychain = 'common-keychain-123';

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
  });

  it('should succeed in handling TRON consolidation recovery for onchain wallet', async () => {
    const mockTransactions = [
      { txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' },
      { txHex: 'unsigned-tx-2', serializedTx: 'serialized-unsigned-tx-2' },
    ];

    const recoverConsolidationsStub = sinon.stub(Trx.prototype, 'recoverConsolidations').resolves({
      transactions: mockTransactions,
    });

    const recoveryMultisigStub = sinon
      .stub(AdvancedWalletManagerClient.prototype, 'recoveryMultisig')
      .resolves({ txHex: 'signed-tx' });

    const requestPayload = {
      multisigType: 'onchain' as const,
      userPub: mockUserPub,
      backupPub: mockBackupPub,
      bitgoPub: mockBitgoPub,
      tokenContractAddress: 'tron-token-address',
      startingScanIndex: 1,
      endingScanIndex: 3,
    };

    const response = await agent
      .post(`/api/trx/wallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(2);

    sinon.assert.calledOnce(recoverConsolidationsStub);
    sinon.assert.calledTwice(recoveryMultisigStub);

    const callArgs = recoverConsolidationsStub.firstCall.args[0];
    callArgs.should.have.property('tokenContractAddress', 'tron-token-address');
    callArgs.should.have.property('userKey', mockUserPub);
    callArgs.should.have.property('backupKey', mockBackupPub);
    callArgs.should.have.property('bitgoKey', mockBitgoPub);
  });

  it('should succeed in handling Solana consolidation recovery for onchain wallet', async () => {
    const mockTransactions = [{ txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' }];

    const recoverConsolidationsStub = sinon.stub(Sol.prototype, 'recoverConsolidations').resolves({
      transactions: mockTransactions,
    });

    const recoveryMultisigStub = sinon
      .stub(AdvancedWalletManagerClient.prototype, 'recoveryMultisig')
      .resolves({ txHex: 'signed-tx' });

    const requestPayload = {
      multisigType: 'onchain' as const,
      userPub: mockUserPub,
      backupPub: mockBackupPub,
      bitgoPub: mockBitgoPub,
      durableNonces: {
        publicKeys: ['sol-pubkey-1', 'sol-pubkey-2'],
        secretKey: 'sol-secret-key',
      },
    };

    const response = await agent
      .post(`/api/sol/wallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(1);

    sinon.assert.calledOnce(recoverConsolidationsStub);
    sinon.assert.calledOnce(recoveryMultisigStub);

    const callArgs = recoverConsolidationsStub.firstCall.args[0];
    callArgs.should.have.property('durableNonces');
    callArgs.durableNonces.should.have.property('publicKeys').which.is.an.Array();
    callArgs.durableNonces.should.have.property('secretKey', 'sol-secret-key');
    callArgs.should.have.property('userKey', mockUserPub);
    callArgs.should.have.property('backupKey', mockBackupPub);
    callArgs.should.have.property('bitgoKey', mockBitgoPub);
  });

  it('should succeed in handling MPC consolidation recovery with commonKeychain', async () => {
    const mockTxRequests = [
      {
        walletCoin: 'tsui',
        transactions: [
          {
            unsignedTx: {
              txHex: 'unsigned-mpc-tx-1',
              serializedTx: 'serialized-unsigned-mpc-tx-1',
            },
            signatureShares: [],
          },
        ],
      },
    ] as any;

    const recoverConsolidationsStub = sinon.stub(Sui.prototype, 'recoverConsolidations').resolves({
      txRequests: mockTxRequests,
    });

    const recoveryMPCStub = sinon
      .stub(AdvancedWalletManagerClient.prototype, 'recoveryMPC')
      .resolves({ txHex: 'signed-mpc-tx' });

    const requestPayload = {
      multisigType: 'tss' as const,
      commonKeychain: mockCommonKeychain,
      apiKey: 'test-api-key',
      startingScanIndex: 0,
      endingScanIndex: 5,
    };

    const response = await agent
      .post(`/api/tsui/wallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(1);

    sinon.assert.calledOnce(recoverConsolidationsStub);
    sinon.assert.calledOnce(recoveryMPCStub);

    const callArgs = recoverConsolidationsStub.firstCall.args[0];
    callArgs.should.have.property('userKey', '');
    callArgs.should.have.property('backupKey', '');
    callArgs.should.have.property('bitgoKey', mockCommonKeychain);

    const mpcCallArgs = recoveryMPCStub.firstCall.args[0];
    mpcCallArgs.should.have.property('userPub', mockCommonKeychain);
    mpcCallArgs.should.have.property('backupPub', mockCommonKeychain);
    mpcCallArgs.should.have.property('apiKey', 'test-api-key');
  });

  it('should succeed in handling SOL MPC consolidation recovery', async () => {
    const mockTransactions = [{ txHex: 'unsigned-mpc-tx-1', serializedTx: 'serialized-mpc-tx-1' }];

    const recoverConsolidationsStub = sinon.stub(Sol.prototype, 'recoverConsolidations').resolves({
      transactions: mockTransactions,
    });

    const recoveryMPCStub = sinon
      .stub(AdvancedWalletManagerClient.prototype, 'recoveryMPC')
      .resolves({ txHex: 'signed-mpc-tx' });

    const requestPayload = {
      multisigType: 'tss' as const,
      commonKeychain: mockCommonKeychain,
      apiKey: 'sol-api-key',
      durableNonces: {
        publicKeys: ['sol-pubkey-1'],
        secretKey: 'sol-secret',
      },
    };

    const response = await agent
      .post(`/api/sol/wallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(1);

    sinon.assert.calledOnce(recoverConsolidationsStub);
    sinon.assert.calledOnce(recoveryMPCStub);

    const mpcCallArgs = recoveryMPCStub.firstCall.args[0];
    mpcCallArgs.should.have.property('userPub', mockCommonKeychain);
    mpcCallArgs.should.have.property('backupPub', mockCommonKeychain);
    mpcCallArgs.should.have.property('apiKey', 'sol-api-key');
  });

  it('should succeed in handling multiple recovery consolidations', async () => {
    const mockTransactions = [
      { txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' },
      { txHex: 'unsigned-tx-2', serializedTx: 'serialized-unsigned-tx-2' },
      { txHex: 'unsigned-tx-3', serializedTx: 'serialized-unsigned-tx-3' },
    ];

    const recoverConsolidationsStub = sinon.stub(Trx.prototype, 'recoverConsolidations').resolves({
      transactions: mockTransactions,
    });

    const recoveryMultisigStub = sinon
      .stub(AdvancedWalletManagerClient.prototype, 'recoveryMultisig')
      .resolves({ txHex: 'signed-tx' });

    const requestPayload = {
      multisigType: 'onchain' as const,
      userPub: mockUserPub,
      backupPub: mockBackupPub,
      bitgoPub: mockBitgoPub,
      startingScanIndex: 0,
      endingScanIndex: 10,
    };

    const response = await agent
      .post(`/api/trx/wallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(requestPayload);

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    response.body.signedTxs.should.have.length(3);

    sinon.assert.calledOnce(recoverConsolidationsStub);
    sinon.assert.calledThrice(recoveryMultisigStub);
  });

  it('should fail when commonKeychain is missing for MPC wallet', async () => {
    const response = await agent
      .post(`/api/tsui/wallet/recoveryconsolidations`)
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
      .post(`/api/trx/wallet/recoveryconsolidations`)
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
      .post(`/api/trx/wallet/recoveryconsolidations`)
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
      .post(`/api/trx/wallet/recoveryconsolidations`)
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
    const response = await agent.post(`/api/trx/wallet/recoveryconsolidations`).send({
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
    const recoverConsolidationsStub = sinon.stub(Trx.prototype, 'recoverConsolidations').resolves({
      transactions: [],
    } as any);

    const response = await agent
      .post(`/api/trx/wallet/recoveryconsolidations`)
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

    sinon.assert.calledOnce(recoverConsolidationsStub);
  });

  it('should fail when recoverConsolidations returns unexpected result structure', async () => {
    const recoverConsolidationsStub = sinon.stub(Trx.prototype, 'recoverConsolidations').resolves({
      someOtherProperty: 'value',
    } as any);

    const response = await agent
      .post(`/api/trx/wallet/recoveryconsolidations`)
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
    const recoverConsolidationsStub = sinon
      .stub(Trx.prototype, 'recoverConsolidations')
      .rejects(new Error('Failed to recover consolidations'));

    const response = await agent
      .post(`/api/trx/wallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details', 'Failed to recover consolidations');

    sinon.assert.calledOnce(recoverConsolidationsStub);
  });

  it('should fail when awmClient throws an error', async () => {
    const mockTransactions = [{ txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' }];

    const recoverConsolidationsStub = sinon.stub(Trx.prototype, 'recoverConsolidations').resolves({
      transactions: mockTransactions,
    });

    const recoveryMultisigStub = sinon
      .stub(AdvancedWalletManagerClient.prototype, 'recoveryMultisig')
      .rejects(new Error('Advanced Wallet Manager signing failed'));

    const response = await agent
      .post(`/api/trx/wallet/recoveryconsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        multisigType: 'onchain',
        userPub: mockUserPub,
        backupPub: mockBackupPub,
        bitgoPub: mockBitgoPub,
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have.property('details', 'Advanced Wallet Manager signing failed');

    sinon.assert.calledOnce(recoverConsolidationsStub);
    sinon.assert.calledOnce(recoveryMultisigStub);
  });

  it('should fail when durableNonces parameter is not correctly structured', async () => {
    const response = await agent
      .post(`/api/sol/wallet/recoveryconsolidations`)
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
