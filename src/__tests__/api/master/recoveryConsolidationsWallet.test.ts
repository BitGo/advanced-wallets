import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Trx } from '@bitgo/sdk-coin-trx';
import { Sol } from '@bitgo/sdk-coin-sol';
import { Sui } from '@bitgo/sdk-coin-sui';
import { EnclavedExpressClient } from '../../../api/master/clients/enclavedExpressClient';

describe('POST /api/:coin/wallet/recoveryconsolidations', () => {
  let agent: request.SuperAgentTest;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const accessToken = 'test-token';

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      enclavedExpressUrl,
      enclavedExpressCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      mtlsRequestCert: false,
      allowSelfSigned: true,
    };
    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  describe('Non-MPC Wallets (multisigType: onchain)', () => {
    it('should handle TRON consolidation recovery for onchain wallet', async () => {
      const mockTransactions = [
        { txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' },
        { txHex: 'unsigned-tx-2', serializedTx: 'serialized-unsigned-tx-2' },
      ];

      const recoverConsolidationsStub = sinon
        .stub(Trx.prototype, 'recoverConsolidations')
        .resolves({
          transactions: mockTransactions,
        });

      const recoveryMultisigStub = sinon
        .stub(EnclavedExpressClient.prototype, 'recoveryMultisig')
        .resolves({ txHex: 'signed-tx' });

      const response = await agent
        .post(`/api/trx/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'onchain',
          userPub: 'user-xpub',
          backupPub: 'backup-xpub',
          bitgoPub: 'bitgo-xpub',
          tokenContractAddress: 'tron-token',
          startingScanIndex: 1,
          endingScanIndex: 3,
        });

      response.status.should.equal(200);
      response.body.should.have.property('signedTxs');
      response.body.signedTxs.should.have.length(2);

      sinon.assert.calledOnce(recoverConsolidationsStub);
      sinon.assert.calledTwice(recoveryMultisigStub);

      const callArgs = recoverConsolidationsStub.firstCall.args[0];
      callArgs.tokenContractAddress!.should.equal('tron-token');
      callArgs.userKey!.should.equal('user-xpub');
      callArgs.backupKey!.should.equal('backup-xpub');
      callArgs.bitgoKey.should.equal('bitgo-xpub');
    });

    it('should handle Solana consolidation recovery for onchain wallet', async () => {
      const mockTransactions = [
        { txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' },
      ];

      const recoverConsolidationsStub = sinon
        .stub(Sol.prototype, 'recoverConsolidations')
        .resolves({
          transactions: mockTransactions,
        });

      const recoveryMultisigStub = sinon
        .stub(EnclavedExpressClient.prototype, 'recoveryMultisig')
        .resolves({ txHex: 'signed-tx' });

      const response = await agent
        .post(`/api/sol/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'onchain',
          userPub: 'user-xpub',
          backupPub: 'backup-xpub',
          bitgoPub: 'bitgo-xpub',
          durableNonces: {
            publicKeys: ['sol-pubkey-1', 'sol-pubkey-2'],
            secretKey: 'sol-secret',
          },
        });

      response.status.should.equal(200);
      response.body.should.have.property('signedTxs');
      sinon.assert.calledOnce(recoverConsolidationsStub);
      sinon.assert.calledOnce(recoveryMultisigStub);

      const callArgs = recoverConsolidationsStub.firstCall.args[0];
      callArgs.durableNonces.should.have.property('publicKeys').which.is.an.Array();
      callArgs.durableNonces.should.have.property('secretKey', 'sol-secret');
      callArgs.userKey!.should.equal('user-xpub');
      callArgs.backupKey!.should.equal('backup-xpub');
      callArgs.bitgoKey.should.equal('bitgo-xpub');
    });
  });

  describe('MPC Wallets (multisigType: tss)', () => {
    it('should handle MPC consolidation recovery with commonKeychain', async () => {
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

      const recoverConsolidationsStub = sinon
        .stub(Sui.prototype, 'recoverConsolidations')
        .resolves({
          txRequests: mockTxRequests,
        });

      const recoveryMPCStub = sinon
        .stub(EnclavedExpressClient.prototype, 'recoveryMPC')
        .resolves({ txHex: 'signed-mpc-tx' });

      const response = await agent
        .post(`/api/tsui/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'tss',
          commonKeychain: 'common-keychain-key',
          apiKey: 'test-api-key',
          startingScanIndex: 0,
          endingScanIndex: 5,
        });

      response.status.should.equal(200);
      response.body.should.have.property('signedTxs');
      response.body.signedTxs.should.have.length(1);

      sinon.assert.calledOnce(recoverConsolidationsStub);
      sinon.assert.calledOnce(recoveryMPCStub);

      const callArgs = recoverConsolidationsStub.firstCall.args[0];
      callArgs.userKey!.should.equal('');
      callArgs.backupKey!.should.equal('');
      callArgs.bitgoKey.should.equal('common-keychain-key');

      const mpcCallArgs = recoveryMPCStub.firstCall.args[0];
      mpcCallArgs.userPub.should.equal('common-keychain-key');
      mpcCallArgs.backupPub.should.equal('common-keychain-key');
      mpcCallArgs.apiKey.should.equal('test-api-key');
    });

    it('should handle SOL MPC consolidation recovery', async () => {
      const mockTransactions = [
        { txHex: 'unsigned-mpc-tx-1', serializedTx: 'serialized-mpc-tx-1' },
      ];

      const recoverConsolidationsStub = sinon
        .stub(Sol.prototype, 'recoverConsolidations')
        .resolves({
          transactions: mockTransactions,
        });

      const recoveryMPCStub = sinon
        .stub(EnclavedExpressClient.prototype, 'recoveryMPC')
        .resolves({ txHex: 'signed-mpc-tx' });

      const response = await agent
        .post(`/api/sol/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'tss',
          commonKeychain: 'sol-common-key',
          apiKey: 'sol-api-key',
          durableNonces: {
            publicKeys: ['sol-pubkey-1'],
            secretKey: 'sol-secret',
          },
        });

      response.status.should.equal(200);
      response.body.should.have.property('signedTxs');
      sinon.assert.calledOnce(recoverConsolidationsStub);
      sinon.assert.calledOnce(recoveryMPCStub);

      const mpcCallArgs = recoveryMPCStub.firstCall.args[0];
      mpcCallArgs.userPub.should.equal('sol-common-key');
      mpcCallArgs.backupPub.should.equal('sol-common-key');
      mpcCallArgs.apiKey.should.equal('sol-api-key');
    });
  });

  describe('Error Cases', () => {
    it('should throw error when commonKeychain is missing for MPC wallet', async () => {
      const response = await agent
        .post(`/api/tsui/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'tss',
          // Missing commonKeychain
          apiKey: 'test-api-key',
        });

      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.should.have
        .property('details')
        .which.match(/Missing required key: commonKeychain/);
    });

    it('should throw error when required keys are missing for onchain wallet', async () => {
      const response = await agent
        .post(`/api/trx/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'onchain',
          userPub: 'user-xpub',
          // Missing backupPub and bitgoPub
        });

      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.should.have.property('details').which.match(/Missing required keys/);
    });

    it('should handle empty recovery consolidations result', async () => {
      const recoverConsolidationsStub = sinon
        .stub(Trx.prototype, 'recoverConsolidations')
        .resolves({
          transactions: [], // Empty result
        } as any);

      const response = await agent
        .post(`/api/trx/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'onchain',
          userPub: 'user-xpub',
          backupPub: 'backup-xpub',
          bitgoPub: 'bitgo-xpub',
        });

      response.status.should.equal(200);
      response.body.should.have.property('signedTxs');
      response.body.signedTxs.should.have.length(0); // Empty array

      sinon.assert.calledOnce(recoverConsolidationsStub);
    });

    it('should throw error when recoverConsolidations returns unexpected result structure', async () => {
      const recoverConsolidationsStub = sinon
        .stub(Trx.prototype, 'recoverConsolidations')
        .resolves({
          // Missing both transactions and txRequests properties
          someOtherProperty: 'value',
        } as any);

      const response = await agent
        .post(`/api/trx/wallet/recoveryconsolidations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          multisigType: 'onchain',
          userPub: 'user-xpub',
          backupPub: 'backup-xpub',
          bitgoPub: 'bitgo-xpub',
        });

      response.status.should.equal(500);
      response.body.should.have.property('error');
      response.body.should.have
        .property('details')
        .which.match(/recoverConsolidations did not return expected transactions/);

      sinon.assert.calledOnce(recoverConsolidationsStub);
    });
  });
});
