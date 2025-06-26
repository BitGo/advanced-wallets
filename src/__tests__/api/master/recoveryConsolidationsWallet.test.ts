import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Trx } from '@bitgo/sdk-coin-trx';
import { Sol } from '@bitgo/sdk-coin-sol';
import { EnclavedExpressClient } from '../../../api/master/clients/enclavedExpressClient';

describe('POST /api/:coin/wallet/recoveryConsolidations', () => {
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

  it('should handle TRON consolidation recovery', async () => {
    const mockTransactions = [{ txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' }];

    const recoverConsolidationsStub = sinon.stub(Trx.prototype, 'recoverConsolidations').resolves({
      transactions: mockTransactions,
    });

    const recoveryMultisigStub = sinon
      .stub(EnclavedExpressClient.prototype, 'recoveryMultisig')
      .resolves({ txHex: 'signed-tx' });

    const response = await agent
      .post(`/api/trx/wallet/recoveryConsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub: 'user-xpub',
        backupPub: 'backup-xpub',
        bitgoKey: 'bitgo-xpub',
        tokenContractAddress: 'tron-token',
        startingScanIndex: 1,
        endingScanIndex: 3,
      });

    response.status.should.equal(200);
    response.body.should.have.property('signedTxs');
    sinon.assert.calledOnce(recoverConsolidationsStub);
    sinon.assert.calledOnce(recoveryMultisigStub);
    const callArgs = recoverConsolidationsStub.firstCall.args[0];
    callArgs.tokenContractAddress!.should.equal('tron-token');
    callArgs.userKey.should.equal('user-xpub');
    callArgs.backupKey.should.equal('backup-xpub');
    callArgs.bitgoKey.should.equal('bitgo-xpub');
  });

  it('should handle Solana consolidation recovery', async () => {
    const mockTransactions = [{ txHex: 'unsigned-tx-1', serializedTx: 'serialized-unsigned-tx-1' }];

    const recoverConsolidationsStub = sinon.stub(Sol.prototype, 'recoverConsolidations').resolves({
      transactions: mockTransactions,
    });

    const recoveryMultisigStub = sinon
      .stub(EnclavedExpressClient.prototype, 'recoveryMultisig')
      .resolves({ txHex: 'signed-tx' });

    const response = await agent
      .post(`/api/sol/wallet/recoveryConsolidations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        userPub: 'user-xpub',
        backupPub: 'backup-xpub',
        bitgoKey: 'bitgo-xpub',
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
  });
});
