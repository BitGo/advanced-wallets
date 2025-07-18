import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo/sdk-core';

describe('POST /api/:coin/wallet/:walletId/consolidateunspents', () => {
  let agent: request.SuperAgentTest;
  const coin = 'btc';
  const walletId = 'test-wallet-id';
  const accessToken = 'test-access-token';
  const bitgoApiUrl = Environments.test.uri;
  const enclavedExpressUrl = 'https://test-enclaved-express.com';

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 30000,
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      enclavedExpressUrl: enclavedExpressUrl,
      enclavedExpressCert: 'test-cert',
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

  it('should return transfer, txid, tx, and status on success', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
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

    const consolidateUnspentsStub = sinon
      .stub(Wallet.prototype, 'consolidateUnspents')
      .resolves(mockResult);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'xpub_user',
        feeRate: 1000,
      });

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
  });

  it('should throw error when provided pubkey does not match wallet keychain', async () => {
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
      });

    const keychainGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/key/user-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'user-key-id',
        pub: 'xpub_user',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidateunspents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        pubkey: 'wrong_pubkey',
        feeRate: 1000,
      });

    response.status.should.equal(500);

    walletGetNock.done();
    keychainGetNock.done();
  });
});
