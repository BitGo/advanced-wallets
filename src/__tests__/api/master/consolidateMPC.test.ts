import 'should';
import sinon from 'sinon';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments, Wallet } from '@bitgo/sdk-core';
import * as eddsa from '../../../api/master/handlers/eddsa';

describe('POST /api/:coin/wallet/:walletId/consolidate (EDDSA MPC)', () => {
  let agent: request.SuperAgentTest;
  const coin = 'tsol';
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

  it('should consolidate using EDDSA MPC custom hooks', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType: 'tss',
      });

    // Mock keychain get request
    const keychainGetNock = nock(bitgoApiUrl).get(`/api/v2/${coin}/key/user-key-id`).reply(200, {
      id: 'user-key-id',
      commonKeychain: 'pubkey',
    });

    // Mock sendAccountConsolidations on Wallet prototype
    const sendConsolidationsStub = sinon
      .stub(Wallet.prototype, 'sendAccountConsolidations')
      .resolves({
        success: [
          {
            txid: 'mpc-txid-1',
            status: 'signed',
          },
        ],
        failure: [],
      });

    // Spy on custom EDDSA hooks - these should return actual functions, not strings
    const mockCommitmentFn = sinon.stub().resolves({ userToBitgoCommitment: 'commitment' });
    const mockRShareFn = sinon.stub().resolves({ rShare: 'rshare' });
    const mockGShareFn = sinon.stub().resolves({ gShare: 'gshare' });

    const commitmentSpy = sinon
      .stub(eddsa, 'createCustomCommitmentGenerator')
      .returns(mockCommitmentFn);
    const rshareSpy = sinon.stub(eddsa, 'createCustomRShareGenerator').returns(mockRShareFn);
    const gshareSpy = sinon.stub(eddsa, 'createCustomGShareGenerator').returns(mockGShareFn);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        commonKeychain: 'pubkey',
      });

    response.status.should.equal(200);
    response.body.should.have.property('success');
    response.body.success.should.have.length(1);
    response.body.success[0].should.have.property('txid', 'mpc-txid-1');

    walletGetNock.done();
    keychainGetNock.done();
    sinon.assert.calledOnce(sendConsolidationsStub);
    sinon.assert.calledOnce(commitmentSpy);
    sinon.assert.calledOnce(rshareSpy);
    sinon.assert.calledOnce(gshareSpy);
  });

  it('should handle partial failures (some success, some failure)', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType: 'tss',
      });

    // Mock keychain get request
    const keychainGetNock = nock(bitgoApiUrl).get(`/api/v2/${coin}/key/user-key-id`).reply(200, {
      id: 'user-key-id',
      commonKeychain: 'pubkey',
    });

    // Mock partial failure response
    sinon.stub(Wallet.prototype, 'sendAccountConsolidations').resolves({
      success: [{ txid: 'success-txid', status: 'signed' }],
      failure: [{ error: 'Insufficient funds', address: '0xfailed' }],
    });

    // Mock EDDSA hooks
    const mockCommitmentFn = sinon.stub().resolves({ userToBitgoCommitment: 'commitment' });
    const mockRShareFn = sinon.stub().resolves({ rShare: 'rshare' });
    const mockGShareFn = sinon.stub().resolves({ gShare: 'gshare' });

    sinon.stub(eddsa, 'createCustomCommitmentGenerator').returns(mockCommitmentFn);
    sinon.stub(eddsa, 'createCustomRShareGenerator').returns(mockRShareFn);
    sinon.stub(eddsa, 'createCustomGShareGenerator').returns(mockGShareFn);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        commonKeychain: 'pubkey',
        consolidateAddresses: ['0x1234567890abcdef', '0xfedcba0987654321'],
      });

    response.status.should.equal(500);
    response.body.should.have.property('error', 'Internal Server Error');
    response.body.should.have
      .property('details')
      .which.match(/Consolidations failed: 1 and succeeded: 1/);

    walletGetNock.done();
    keychainGetNock.done();
  });

  it('should handle total failures (all failed)', async () => {
    // Mock wallet get request
    const walletGetNock = nock(bitgoApiUrl)
      .get(`/api/v2/${coin}/wallet/${walletId}`)
      .reply(200, {
        id: walletId,
        type: 'cold',
        subType: 'onPrem',
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        multisigType: 'tss',
      });

    // Mock keychain get request
    const keychainGetNock = nock(bitgoApiUrl).get(`/api/v2/${coin}/key/user-key-id`).reply(200, {
      id: 'user-key-id',
      commonKeychain: 'pubkey',
    });

    // Mock total failure response
    sinon.stub(Wallet.prototype, 'sendAccountConsolidations').resolves({
      success: [],
      failure: [
        { error: 'Insufficient funds', address: '0xfailed1' },
        { error: 'Invalid address', address: '0xfailed2' },
      ],
    });

    // Mock EDDSA hooks
    const mockCommitmentFn = sinon.stub().resolves({ userToBitgoCommitment: 'commitment' });
    const mockRShareFn = sinon.stub().resolves({ rShare: 'rshare' });
    const mockGShareFn = sinon.stub().resolves({ gShare: 'gshare' });

    sinon.stub(eddsa, 'createCustomCommitmentGenerator').returns(mockCommitmentFn);
    sinon.stub(eddsa, 'createCustomRShareGenerator').returns(mockRShareFn);
    sinon.stub(eddsa, 'createCustomGShareGenerator').returns(mockGShareFn);

    const response = await agent
      .post(`/api/${coin}/wallet/${walletId}/consolidate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        source: 'user',
        commonKeychain: 'pubkey',
      });

    response.status.should.equal(500);
    response.body.should.have.property('error');
    response.body.should.have.property('details').which.match(/All consolidations failed/);

    walletGetNock.done();
    keychainGetNock.done();
  });
});
