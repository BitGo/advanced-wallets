import 'should';

import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../masterExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
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
    const constantsNock = nock(bitgoApiUrl)
      .get('/api/v1/client/constants')
      // Not sure why the nock is not matching any headers, but this works
      .matchHeader('accept-encoding', 'gzip, deflate')
      .matchHeader('bitgo-sdk-version', '48.1.0')
      .reply(200, {
        constants: {
          mpc: {
            bitgoPublicKey: 'test-bitgo-public-key',
          },
        },
      });

    const userInitNock = nock(enclavedExpressUrl)
      .post(`/api/${eddsaCoin}/mpc/key/initialize`, {
        source: 'user',
        bitgoGpgPub: 'test-bitgo-public-key',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        bitgoPayload: {
          from: 'user',
          to: 'bitgo',
          publicShare: 'public-share-user',
          privateShare: 'private-share-user-to-bitgo',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'user-key',
        },
      });

    const backupInitNock = nock(enclavedExpressUrl)
      .post(`/api/${eddsaCoin}/mpc/key/initialize`, {
        source: 'backup',
        bitgoGpgPub: 'test-bitgo-public-key',
        counterPartyGpgPub: 'user-key',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        bitgoPayload: {
          from: 'backup',
          to: 'bitgo',
          publicShare: 'public-share-backup',
          privateShare: 'private-share-backup-to-bitgo',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'backup-key',
        },
        counterPartyKeyShare: {
          from: 'backup',
          to: 'user',
          publicShare: 'public-share-backup',
          privateShare: 'private-share-backup-to-user',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'backup-key',
        },
      });

    const bitgoAddKeychainNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/key`, {
        keyType: 'tss',
        source: 'bitgo',
        enterprise: 'test_enterprise',
        keyShares: [
          {
            from: 'user',
            to: 'bitgo',
            publicShare: 'public-share-user',
            privateShare: 'private-share-user-to-bitgo',
            privateShareProof: 'proof',
            vssProof: 'proof',
            gpgKey: 'user-key',
          },
          {
            from: 'backup',
            to: 'bitgo',
            publicShare: 'public-share-backup',
            privateShare: 'private-share-backup-to-bitgo',
            privateShareProof: 'proof',
            vssProof: 'proof',
            gpgKey: 'backup-key',
          },
        ],
        userGPGPublicKey: 'user-key',
        backupGPGPublicKey: 'backup-key',
      })
      .reply(200, {
        id: 'id',
        source: 'bitgo',
        type: 'tss',
        commonKeychain: 'commonKeychain',
        verifiedVssProof: true,
        isBitGo: true,
        isTrust: true,
        hsmType: 'institutional',
        keyShares: [
          {
            from: 'bitgo',
            to: 'user',
            publicShare: 'publicShare',
            privateShare: 'privateShare',
            vssProof: 'true',
            gpgKey: 'bitgo-key',
          },
          {
            from: 'bitgo',
            to: 'backup',
            publicShare: 'publicShare',
            privateShare: 'privateShare',
            vssProof: 'true',
            gpgKey: 'bitgo-key',
          },
        ],
        walletHSMGPGPublicKeySigs: 'hsm-sig',
      });

    const userFinalizeNock = nock(enclavedExpressUrl)
      .post(`/api/${eddsaCoin}/mpc/key/finalize`, {
        source: 'user',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        counterPartyGpgPub: 'backup-key',
        bitgoKeyChain: {
          id: 'id',
          source: 'bitgo',
          type: 'tss',
          commonKeychain: 'commonKeychain',
          verifiedVssProof: true,
          isBitGo: true,
          isTrust: false,
          hsmType: 'institutional',
          keyShares: [
            {
              from: 'bitgo',
              to: 'user',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
            {
              from: 'bitgo',
              to: 'backup',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
          ],
          walletHSMGPGPublicKeySigs: 'hsm-sig',
        },
        coin: 'tsol',
        counterPartyKeyShare: {
          from: 'backup',
          to: 'user',
          publicShare: 'public-share-backup',
          privateShare: 'private-share-backup-to-user',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'backup-key',
        },
      })
      .reply(200, {
        counterpartyKeyShare: {
          from: 'user',
          to: 'backup',
          publicShare: 'publicShare',
          privateShare: 'privateShare',
          privateShareProof: 'privateShareProof',
          vssProof: 'vssProof',
          gpgKey: 'user-key',
        },
        source: 'user',
        commonKeychain: 'commonKeychain',
      });
    const addUserKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/key`, {
        commonKeychain: 'commonKeychain',
        source: 'user',
        type: 'tss',
      })
      .reply(200, {
        id: 'id',
        source: 'user',
        type: 'tss',
        commonKeychain: 'commonKeychain',
      });
    const backupFinalizeNock = nock(enclavedExpressUrl)
      .post(`/api/${eddsaCoin}/mpc/key/finalize`, {
        source: 'backup',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        counterPartyGpgPub: 'user-key',
        bitgoKeyChain: {
          id: 'id',
          source: 'bitgo',
          type: 'tss',
          commonKeychain: 'commonKeychain',
          verifiedVssProof: true,
          isBitGo: true,
          isTrust: false,
          hsmType: 'institutional',
          keyShares: [
            {
              from: 'bitgo',
              to: 'user',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
            {
              from: 'bitgo',
              to: 'backup',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
          ],
          walletHSMGPGPublicKeySigs: 'hsm-sig',
        },
        coin: 'tsol',
        counterPartyKeyShare: {
          from: 'user',
          to: 'backup',
          publicShare: 'publicShare',
          privateShare: 'privateShare',
          privateShareProof: 'privateShareProof',
          vssProof: 'vssProof',
          gpgKey: 'user-key',
        },
      })
      .reply(200, {
        source: 'backup',
        commonKeychain: 'commonKeychain',
      });

    const addBackupKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/key`, {
        source: 'backup',
        type: 'tss',
        commonKeychain: 'commonKeychain',
      })
      .reply(200, {
        id: 'id',
        source: 'backup',
        type: 'tss',
        commonKeychain: 'commonKeychain',
      });

    const addWalletNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/wallet/add`, {
        label: 'test_wallet',
        m: 2,
        n: 3,
        keys: ['id', 'id', 'id'],
        type: 'cold',
        subType: 'onPrem',
        multisigType: 'tss',
        enterprise: 'test_enterprise',
      })
      .reply(200, {
        id: '685cb53debcd0bcb5ab4fe80d2b74be2',
        users: [['Object']],
        coin: 'tsol',
        label: 'OnPrem eddsa sendMany test 2025-06-26T02:49:18.622Z',
        m: 2,
        n: 3,
        keys: [
          '685cb5393d57687bdf0a464594ca9e36',
          '685cb53a3d57687bdf0a4657b5f1f364',
          '685cb536f21050339163a75dd04d41bf',
        ],
        keySignatures: {},
        enterprise: '6750c2d327511bc4e5f83ccfcfe1b3eb',
        organization: '6750c2e027511bc4e5f83d251248fc14',
        bitgoOrg: 'BitGo Trust',
        tags: ['685cb53debcd0bcb5ab4fe80d2b74be2', '6750c2d327511bc4e5f83ccfcfe1b3eb'],
        disableTransactionNotifications: false,
        freeze: {},
        deleted: false,
        approvalsRequired: 1,
        isCold: true,
        coinSpecific: {
          rootAddress: '74AUHib3F6Fq5eVm2ywP5ik9iQjviwAfZXWnGM9JHhJ4',
          pendingChainInitialization: true,
          minimumFunding: 2447136,
          lastChainIndex: ['Object'],
          nonceExpiresAt: '2025-06-25T23:00:12.019Z',
          trustedTokens: [],
        },
        admin: {
          policy: ['Object'],
        },
        clientFlags: [],
        walletFlags: [],
        allowBackupKeySigning: false,
        recoverable: false,
        startDate: '2025-06-26T02:49:33.000Z',
        type: 'cold',
        buildDefaults: {},
        customChangeKeySignatures: {},
        hasLargeNumberOfAddresses: false,
        multisigType: 'tss',
        hasReceiveTransferPolicy: false,
        creator: '63f512adc61d7100088e99bf1deece73',
        subType: 'onPrem',
        config: {},
        pendingChainInitialization: true,
        balanceString: '0',
        confirmedBalanceString: '0',
        spendableBalanceString: '0',
        reservedBalanceString: '0',
        receiveAddress: {
          id: '685cb53eebcd0bcb5ab4fe8ed214d5b9',
          address: '74AUHib3F6Fq5eVm2ywP5ik9iQjviwAfZXWnGM9JHhJ4',
          chain: 0,
          index: 0,
          coin: 'tsol',
          wallet: '685cb53debcd0bcb5ab4fe80d2b74be2',
          coinSpecific: ['Object'],
        },
      });

    const response = await agent
      .post(`/api/${eddsaCoin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
        multisigType: 'tss',
      });

    constantsNock.done();
    userInitNock.done();
    backupInitNock.done();
    bitgoAddKeychainNock.done();
    userFinalizeNock.done();
    addUserKeyNock.done();
    backupFinalizeNock.done();
    addBackupKeyNock.done();
    addWalletNock.done();
    response.status.should.equal(200); // TODO: Update to 200 when fully integrated with finalize endpoint
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
