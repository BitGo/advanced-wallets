import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../types';
import { Environments } from '@bitgo/sdk-core';
import assert from 'assert';

describe('POST /api/:coin/wallet/generate', () => {
  let agent: request.SuperAgentTest;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const coin = 'tbtc';
  const eddsaCoin = 'tsol';
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

  it('should generate a wallet by calling the enclaved express service', async () => {
    const userKeychainNock = nock(enclavedExpressUrl)
      .post(`/api/${coin}/key/independent`, {
        source: 'user',
      })
      .reply(200, {
        pub: 'xpub_user',
        source: 'user',
        type: 'independent',
      });

    const backupKeychainNock = nock(enclavedExpressUrl)
      .post(`/api/${coin}/key/independent`, {
        source: 'backup',
      })
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

  it('should generate a TSS wallet by calling the enclaved express service', async () => {
    const userInitNock = nock(enclavedExpressUrl)
      .post(`/api/${eddsaCoin}/mpc/initialize`, {
        source: 'user',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        bitgoPayload: {
          from: 'user',
          to: 'bitgo',
          publicShare:
            'dcf591bfb22f9764ed382dcb397f591bdb64c69773c6cf2902d14789a13811a0a768fb0eae38f9ebe2b047182e2a95bb49921bfec56bcd96e3075e53396c1775',
          privateShare:
            '175bdf3264662e1d13de1dacc22c0913b367f165fb15439fe687cbdc1713560ca768fb0eae38f9ebe2b047182e2a95bb49921bfec56bcd96e3075e53396c1775',
          privateShareProof:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaFRmgBMFK4EEAAoCAwTGXYL4mPPKg3u1KkPeXR9lOqqem/i3kgdgQE9P\nIZlvNdZyVcoAyrTos0Negm39jQPzssKbjNYbwmD6oBliJIWDzVUxYzU3NDY3\nNmUwNWM3Zjc0Zjg4YmM5YmEgPHVzZXItMWM1NzQ2NzZlMDVjN2Y3NGY4OGJj\nOWJhQDFjNTc0Njc2ZTA1YzdmNzRmODhiYzliYS5jb20+wowEEBMIAD4FgmhU\nZoAECwkHCAmQ6ylVI/YkWEQDFQgKBBYAAgECGQECmwMCHgEWIQRS2wpzMoJX\nVNidgnnrKVUj9iRYRAAA0kkA/R78hy0CNnUPCMMi2Co6VlYALrx+xFydb0+7\n8Yza5IF2AP93Xc9FKo8OPO5pg5uPnC6fXvsJqVne289iETTtsihaaM5TBGhU\nZoASBSuBBAAKAgME99PyPC8OyvjMb5GMLIvU3UOa8vDHDw4EJxEk9vjP1M8w\n9Uz8BlRby1wYFShcTYrl8lqBmvO9KswHXSLvwyw1QAMBCAfCeAQYEwgAKgWC\naFRmgAmQ6ylVI/YkWEQCmwwWIQRS2wpzMoJXVNidgnnrKVUj9iRYRAAASxsA\n/RbBP5LPbfcAay8osipVWf/oTzw2/tKzER0K3FfAAsImAP0c2ee+qa0Tn5nv\neezRo+XxgIoxw2gT8jYpyzJw+BKBBQ==\n=DYMw\n-----END PGP PUBLIC KEY BLOCK-----\n',
          vssProof: '011532df3eceab48fc91c2e17e7accea1d0dd30b8b7562a5f602afb2130ab26a',
          userGPGPublicKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaFRmgBMFK4EEAAoCAwTGXYL4mPPKg3u1KkPeXR9lOqqem/i3kgdgQE9P\nIZlvNdZyVcoAyrTos0Negm39jQPzssKbjNYbwmD6oBliJIWDzVUxYzU3NDY3\nNmUwNWM3Zjc0Zjg4YmM5YmEgPHVzZXItMWM1NzQ2NzZlMDVjN2Y3NGY4OGJj\nOWJhQDFjNTc0Njc2ZTA1YzdmNzRmODhiYzliYS5jb20+wowEEBMIAD4FgmhU\nZoAECwkHCAmQ6ylVI/YkWEQDFQgKBBYAAgECGQECmwMCHgEWIQRS2wpzMoJX\nVNidgnnrKVUj9iRYRAAA0kkA/R78hy0CNnUPCMMi2Co6VlYALrx+xFydb0+7\n8Yza5IF2AP93Xc9FKo8OPO5pg5uPnC6fXvsJqVne289iETTtsihaaM5TBGhU\nZoASBSuBBAAKAgME99PyPC8OyvjMb5GMLIvU3UOa8vDHDw4EJxEk9vjP1M8w\n9Uz8BlRby1wYFShcTYrl8lqBmvO9KswHXSLvwyw1QAMBCAfCeAQYEwgAKgWC\naFRmgAmQ6ylVI/YkWEQCmwwWIQRS2wpzMoJXVNidgnnrKVUj9iRYRAAASxsA\n/RbBP5LPbfcAay8osipVWf/oTzw2/tKzER0K3FfAAsImAP0c2ee+qa0Tn5nv\neezRo+XxgIoxw2gT8jYpyzJw+BKBBQ==\n=DYMw\n-----END PGP PUBLIC KEY BLOCK-----\n',
        },
      });

    const backupInitNock = nock(enclavedExpressUrl)
      .post(`/api/${eddsaCoin}/mpc/initialize`, {
        source: 'backup',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        bitgoPayload: {
          from: 'backup',
          to: 'bitgo',
          publicShare:
            '280b5d3b40899e6e1cac86906602ffdf76b70aefc2def7f311693aba654cca6ecdcb2be051910ebc9bcbae6ac0db3edf707498b19be0f229102ce76dd880ab9b',
          privateShare:
            '1be0dcb0b3c77bceac11ce77d83b33a5b74ff39f90485d81b2003bc55270b509cdcb2be051910ebc9bcbae6ac0db3edf707498b19be0f229102ce76dd880ab9b',
          privateShareProof:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaFRmgBMFK4EEAAoCAwQbnZsAMbrZ6LnlMT8ZjmCyq4Au+KDEMH9dndk5\nqVpZIgvHzMwZYusZtija5M/erWbg0Iutv1R1olMd9htHSScOzVViMmZlNTRl\nZTI1YzIyOWM0MzJiNzU2MWYgPHVzZXItYjJmZTU0ZWUyNWMyMjljNDMyYjc1\nNjFmQGIyZmU1NGVlMjVjMjI5YzQzMmI3NTYxZi5jb20+wowEEBMIAD4FgmhU\nZoAECwkHCAmQrNctBNmaAcADFQgKBBYAAgECGQECmwMCHgEWIQSJSRD0FwPm\nwraqiESs1y0E2ZoBwAAAqJkBAIhIhHS8i71tbe43TKYThRaOzeo73afL31UE\nbK12huloAQCrjr5GEz+4L84Nl8TcWt5yAI8UF1hi+O5rdP35UL6xKc5TBGhU\nZoASBSuBBAAKAgME+Bm/MFl4fP7CxJsannVVcZ1M+bL8X8kcl30wXaLkiqvg\nZpEunra42o4RwaQcQirsvPX9+di0P2FoFXH/n1+s1wMBCAfCeAQYEwgAKgWC\naFRmgAmQrNctBNmaAcACmwwWIQSJSRD0FwPmwraqiESs1y0E2ZoBwAAAXWoB\nAI9xw2J9mzyPGpnFiIb/qxHRzSbXsNYyPvxUU15rSKiaAP9uy61NJBs3vTT8\nzf33PkAgoxFZsEDLwAsDyOecH/Cilw==\n=0SE8\n-----END PGP PUBLIC KEY BLOCK-----\n',
          vssProof: 'f008212df4a14e81b8b7bca268a3b2b19d65220fb2f0b2e1c8f83e0d9286aec2',
          backupGPGPublicKey:
            '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxk8EaFRmgBMFK4EEAAoCAwQbnZsAMbrZ6LnlMT8ZjmCyq4Au+KDEMH9dndk5\nqVpZIgvHzMwZYusZtija5M/erWbg0Iutv1R1olMd9htHSScOzVViMmZlNTRl\nZTI1YzIyOWM0MzJiNzU2MWYgPHVzZXItYjJmZTU0ZWUyNWMyMjljNDMyYjc1\nNjFmQGIyZmU1NGVlMjVjMjI5YzQzMmI3NTYxZi5jb20+wowEEBMIAD4FgmhU\nZoAECwkHCAmQrNctBNmaAcADFQgKBBYAAgECGQECmwMCHgEWIQSJSRD0FwPm\nwraqiESs1y0E2ZoBwAAAqJkBAIhIhHS8i71tbe43TKYThRaOzeo73afL31UE\nbK12huloAQCrjr5GEz+4L84Nl8TcWt5yAI8UF1hi+O5rdP35UL6xKc5TBGhU\nZoASBSuBBAAKAgME+Bm/MFl4fP7CxJsannVVcZ1M+bL8X8kcl30wXaLkiqvg\nZpEunra42o4RwaQcQirsvPX9+di0P2FoFXH/n1+s1wMBCAfCeAQYEwgAKgWC\naFRmgAmQrNctBNmaAcACmwwWIQSJSRD0FwPmwraqiESs1y0E2ZoBwAAAXWoB\nAI9xw2J9mzyPGpnFiIb/qxHRzSbXsNYyPvxUU15rSKiaAP9uy61NJBs3vTT8\nzf33PkAgoxFZsEDLwAsDyOecH/Cilw==\n=0SE8\n-----END PGP PUBLIC KEY BLOCK-----\n',
        },
      });

    const bitgoAddKeychainNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/key`)
      .reply(function (uri, requestBody) {
        // Verify request structure
        const body = requestBody as any;
        body.should.have.properties({
          keyType: 'tss',
          source: 'bitgo',
          enterprise: 'test_enterprise',
        });

        // Verify key shares structure
        body.should.have.property('keyShares').which.is.an.Array().of.length(2);

        // Verify user share
        const userShare = body.keyShares.find((s: any) => s.from === 'user' && s.to === 'bitgo');
        userShare.should.have.properties([
          'publicShare',
          'privateShare',
          'privateShareProof',
          'vssProof',
        ]);
        userShare.publicShare.should.be.a.String().and.not.empty();
        userShare.privateShare.should.be.a.String().and.not.empty();
        userShare.privateShareProof.should.startWith('-----BEGIN PGP PUBLIC KEY BLOCK-----');
        userShare.vssProof.should.be.a.String().and.not.empty();

        // Verify backup share
        const backupShare = body.keyShares.find(
          (s: any) => s.from === 'backup' && s.to === 'bitgo',
        );
        backupShare.should.have.properties([
          'publicShare',
          'privateShare',
          'privateShareProof',
          'vssProof',
        ]);
        backupShare.publicShare.should.be.a.String().and.not.empty();
        backupShare.privateShare.should.be.a.String().and.not.empty();
        backupShare.privateShareProof.should.startWith('-----BEGIN PGP PUBLIC KEY BLOCK-----');
        backupShare.vssProof.should.be.a.String().and.not.empty();

        // Verify GPG keys
        body.userGPGPublicKey.should.startWith('-----BEGIN PGP PUBLIC KEY BLOCK-----');
        body.backupGPGPublicKey.should.startWith('-----BEGIN PGP PUBLIC KEY BLOCK-----');

        return [
          200,
          {
            id: 'bitgo-key-id',
            commonKeychain:
              '4e534a0193c6636a0727079e25601abd6c2853d63582162bc53ae69b152f0ec2c2e096583da8e7ffd36dff6131a17020727f9543001525c172c1e772900359d3',
          },
        ];
      });

    const response = await agent
      .post(`/api/${eddsaCoin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
        multisigType: 'tss',
      });

    // Verify response status and structure
    response.status.should.equal(500); // TODO: Update to 200 when fully integrated with finalize endpoint
    // response.body.should.have.property('bitgoKeychain');
    //
    // // Verify BitGo keychain properties
    // const bitgoKeychain = response.body.bitgoKeychain;
    // bitgoKeychain.should.have.property('id').which.is.a.String();
    // bitgoKeychain.should.have.property('commonKeychain').which.is.a.String();
    // bitgoKeychain.id.should.equal('bitgo-key-id');
    // bitgoKeychain.commonKeychain.should.equal(
    //   '4e534a0193c6636a0727079e25601abd6c2853d63582162bc53ae69b152f0ec2c2e096583da8e7ffd36dff6131a17020727f9543001525c172c1e772900359d3',
    // );

    // Verify all nock mocks were called
    userInitNock.done();
    backupInitNock.done();
    bitgoAddKeychainNock.done();
  });

  it('should fail when enclaved express client is not configured', async () => {
    // Create a config without enclaved express settings
    const invalidConfig: Partial<MasterExpressConfig> = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      logFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      tlsMode: TlsMode.DISABLED,
      mtlsRequestCert: false,
      allowSelfSigned: true,
    };

    try {
      expressApp(invalidConfig as MasterExpressConfig);
      assert(false, 'Expected error to be thrown when enclaved express client is not configured');
    } catch (e) {
      (e as Error).message.should.equal('enclavedExpressUrl and enclavedExpressCert are required');
    }
  });
});
