import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../types';
import { Environments } from '@bitgo/sdk-core';
import { before, after } from 'mocha';

describe('POST /api/:coin/wallet/generate', () => {
  let agent: request.SuperAgentTest;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const coin = 'tbtc';
  const accessToken = 'test-token';

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      enclavedExpressUrl: enclavedExpressUrl,
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
  });

  after(() => {
    nock.restore();
  });

  it('should generate a wallet by calling the enclaved express service', async () => {
    const userKeychainNock = nock(enclavedExpressUrl)
      .post(`/api/${coin}/key/independent`)
      .reply(200, {
        pub: 'xpub_user',
        source: 'user',
        type: 'independent',
      });

    const backupKeychainNock = nock(enclavedExpressUrl)
      .post(`/api/${coin}/key/independent`)
      .reply(200, {
        pub: 'xpub_backup',
        source: 'backup',
        type: 'independent',
      });

    const bitgoAddUserKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/key`, {
        pub: 'xpub_user',
        keyType: 'independent',
        source: 'user',
      })
      .matchHeader('any', () => true)
      .reply(200, { id: 'user-key-id', pub: 'xpub_user' });

    const bitgoAddBackupKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/key`, {
        pub: 'xpub_backup',
        keyType: 'independent',
        source: 'backup',
      })
      .matchHeader('any', () => true)
      .reply(200, { id: 'backup-key-id', pub: 'xpub_backup' });

    const bitgoAddBitGoKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/key`, {
        source: 'bitgo',
        keyType: 'independent',
        enterprise: 'test_enterprise',
      })
      .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo' });

    const bitgoAddWalletNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/add`, {
        label: 'test_wallet',
        m: 2,
        n: 3,
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        type: 'cold',
        subType: 'onPrem',
        multisigType: 'onchain',
        enterprise: 'test_enterprise',
      })
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'new-wallet-id',
        multisigType: 'onchain',
        type: 'cold',
        subType: 'onPrem',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
      });

    response.status.should.equal(200);
    response.body.should.have.property('wallet');
    response.body.wallet.should.have.properties({
      id: 'new-wallet-id',
      multisigType: 'onchain',
      type: 'cold',
      subType: 'onPrem',
    });
    response.body.should.have.propertyByPath('userKeychain', 'pub').eql('xpub_user');
    response.body.should.have.propertyByPath('backupKeychain', 'pub').eql('xpub_backup');
    response.body.should.have.propertyByPath('bitgoKeychain', 'pub').eql('xpub_bitgo');

    userKeychainNock.done();
    backupKeychainNock.done();
    bitgoAddUserKeyNock.done();
    bitgoAddBackupKeyNock.done();
    bitgoAddBitGoKeyNock.done();
    bitgoAddWalletNock.done();
  });
});
