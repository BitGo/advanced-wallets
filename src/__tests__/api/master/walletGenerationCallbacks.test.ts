import 'should';
import assert from 'assert';
import nock from 'nock';
import {
  createAwmBackupClient,
  createAwmClient,
  AdvancedWalletManagerClient,
} from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';
import {
  createOnchainKeyGenCallback,
  createEddsaMPCv2KeyGenCallbacks,
} from '../../../masterBitgoExpress/handlers/walletGenerationCallbacks';
import { AppMode, KeySource, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { DEFAULT_ASYNC_MODE_CONFIG } from './testUtils';

describe('walletGenerationCallbacks', () => {
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const backupAwmUrl = 'http://backup-awm.invalid';
  const coin = 'tbtc';

  // Valid BIP32 extended public keys required by the SDK's isValidPub check
  const validUserPub =
    'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
  const validBackupPub =
    'xpub661MyMwAqRbcGczjuMoRm6dXaLDEhW1u34gKenbeYqAix21mdUKJyuyu5F1rzYGVxyL6tmgBUAEPrEz92mBXjByMRiJdba9wpnN37RLLAXa';

  let awmUserClient: AdvancedWalletManagerClient;
  let awmBackupClient: AdvancedWalletManagerClient;

  function makeConfig(overrides: Partial<MasterExpressConfig> = {}): MasterExpressConfig {
    return {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl,
      awmServerCaCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG,
      ...overrides,
    };
  }

  before(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    nock.enableNetConnect();
  });

  describe('createOnchainKeyGenCallback', () => {
    describe('with separate backup AWM (separate-HSM mode)', () => {
      beforeEach(() => {
        const config = makeConfig({ advancedWalletManagerBackupUrl: backupAwmUrl });
        awmUserClient = createAwmClient(config, coin)!;
        awmBackupClient = createAwmBackupClient(config, coin)!;
        assert(awmUserClient);
        assert(awmBackupClient);
      });

      it('should route user source to the primary AWM client', async () => {
        const userKeychainNock = nock(advancedWalletManagerUrl)
          .post(`/api/${coin}/key/independent`, {
            source: KeySource.USER,
          })
          .reply(200, {
            pub: validUserPub,
            source: KeySource.USER,
            type: 'independent',
          });

        const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);
        const result = await callback({ source: KeySource.USER, coin });

        result.pub.should.equal(validUserPub);
        result.source.should.equal(KeySource.USER);
        result.type.should.equal('independent');
        userKeychainNock.done();
      });

      it('should route backup source to the backup AWM client', async () => {
        const backupKeychainNock = nock(backupAwmUrl)
          .post(`/api/${coin}/key/independent`, {
            source: KeySource.BACKUP,
          })
          .reply(200, {
            pub: validBackupPub,
            source: KeySource.BACKUP,
            type: 'independent',
          });

        const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);
        const result = await callback({ source: KeySource.BACKUP, coin });

        result.pub.should.equal(validBackupPub);
        result.source.should.equal(KeySource.BACKUP);
        result.type.should.equal('independent');
        backupKeychainNock.done();
      });
    });

    describe('without separate backup AWM (same-HSM mode)', () => {
      beforeEach(() => {
        const config = makeConfig();
        awmUserClient = createAwmClient(config, coin)!;
        awmBackupClient = createAwmBackupClient(config, coin) ?? awmUserClient;
        assert(awmUserClient);
      });

      it('should route backup source to the primary AWM client', async () => {
        const backupKeychainNock = nock(advancedWalletManagerUrl)
          .post(`/api/${coin}/key/independent`, {
            source: KeySource.BACKUP,
          })
          .reply(200, {
            pub: validBackupPub,
            source: KeySource.BACKUP,
            type: 'independent',
          });

        const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);
        const result = await callback({ source: KeySource.BACKUP, coin });

        result.pub.should.equal(validBackupPub);
        result.source.should.equal(KeySource.BACKUP);
        result.type.should.equal('independent');
        backupKeychainNock.done();
      });
    });

    it('should throw for unexpected key sources', async () => {
      const config = makeConfig({ advancedWalletManagerBackupUrl: backupAwmUrl });
      awmUserClient = createAwmClient(config, coin)!;
      awmBackupClient = createAwmBackupClient(config, coin)!;
      assert(awmUserClient);
      assert(awmBackupClient);

      const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);

      await callback({
        source: KeySource.BITGO as 'user',
        coin,
      }).should.be.rejectedWith('Unexpected key source for onchain key generation: bitgo');
    });
  });

  describe('createEddsaMPCv2KeyGenCallbacks', () => {
    const enterprise = 'test-enterprise';
    const bitgoPublicGpgKey = 'test-bitgo-gpg-key';

    beforeEach(() => {
      const config = makeConfig({ advancedWalletManagerBackupUrl: backupAwmUrl });
      awmUserClient = createAwmClient(config, coin)!;
      awmBackupClient = createAwmBackupClient(config, coin)!;
      assert(awmUserClient);
      assert(awmBackupClient);
    });

    it('initializeCallback fans out to user and backup AWM in parallel', async () => {
      const userInitNock = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/eddsampcv2/keygen/initialize`, {
          source: 'user',
          enterprise,
          bitgoPublicGpgKey,
        })
        .reply(200, {
          gpgPublicKey: 'user-gpg-pub',
          signedMsg1: { message: 'user-msg1', signature: 'user-sig1' },
          encryptedState: 'user-enc-state',
          encryptedStateKey: 'user-enc-state-key',
        });

      const backupInitNock = nock(backupAwmUrl)
        .post(`/api/${coin}/eddsampcv2/keygen/initialize`, {
          source: 'backup',
          enterprise,
          bitgoPublicGpgKey,
        })
        .reply(200, {
          gpgPublicKey: 'backup-gpg-pub',
          signedMsg1: { message: 'backup-msg1', signature: 'backup-sig1' },
          encryptedState: 'backup-enc-state',
          encryptedStateKey: 'backup-enc-state-key',
        });

      const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
      const result = await callbacks.initializeCallback({ enterprise, bitgoPublicGpgKey });

      result.userGpgPublicKey.should.equal('user-gpg-pub');
      result.backupGpgPublicKey.should.equal('backup-gpg-pub');
      result.userSignedMsg1.message.should.equal('user-msg1');
      result.backupSignedMsg1.message.should.equal('backup-msg1');
      result.userEncryptedState.should.equal('user-enc-state');
      result.backupEncryptedState.should.equal('backup-enc-state');
      userInitNock.done();
      backupInitNock.done();
    });

    it('round1Callback fans out to user and backup AWM in parallel', async () => {
      const bitgoMsg1 = { message: 'bitgo-msg1', signature: 'bitgo-sig1' };

      const userR1Nock = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/eddsampcv2/keygen/round1`, {
          source: 'user',
          bitgoMsg1,
          encryptedState: 'user-enc-state',
          encryptedStateKey: 'user-enc-state-key',
        })
        .reply(200, {
          signedMsg2: { message: 'user-msg2', signature: 'user-sig2' },
          encryptedState: 'user-enc-state-r1',
          encryptedStateKey: 'user-enc-state-key-r1',
        });

      const backupR1Nock = nock(backupAwmUrl)
        .post(`/api/${coin}/eddsampcv2/keygen/round1`, {
          source: 'backup',
          bitgoMsg1,
          encryptedState: 'backup-enc-state',
          encryptedStateKey: 'backup-enc-state-key',
        })
        .reply(200, {
          signedMsg2: { message: 'backup-msg2', signature: 'backup-sig2' },
          encryptedState: 'backup-enc-state-r1',
          encryptedStateKey: 'backup-enc-state-key-r1',
        });

      const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
      const result = await callbacks.round1Callback({
        bitgoMsg1,
        userEncryptedState: 'user-enc-state',
        userEncryptedStateKey: 'user-enc-state-key',
        backupEncryptedState: 'backup-enc-state',
        backupEncryptedStateKey: 'backup-enc-state-key',
      });

      result.userSignedMsg2.message.should.equal('user-msg2');
      result.backupSignedMsg2.message.should.equal('backup-msg2');
      result.userEncryptedState.should.equal('user-enc-state-r1');
      result.backupEncryptedState.should.equal('backup-enc-state-r1');
      userR1Nock.done();
      backupR1Nock.done();
    });

    it('finalizeCallback fans out to user and backup AWM in parallel', async () => {
      const bitgoMsg2 = { message: 'bitgo-msg2', signature: 'bitgo-sig2' };
      const commonPublicKeychain = 'common-keychain-abc123';

      const userFinalizeNock = nock(advancedWalletManagerUrl)
        .post(`/api/${coin}/eddsampcv2/keygen/finalize`, {
          source: 'user',
          bitgoMsg2,
          commonPublicKeychain,
          encryptedState: 'user-enc-state',
          encryptedStateKey: 'user-enc-state-key',
        })
        .reply(200, {
          source: 'user',
          commonKeychain: commonPublicKeychain,
        });

      const backupFinalizeNock = nock(backupAwmUrl)
        .post(`/api/${coin}/eddsampcv2/keygen/finalize`, {
          source: 'backup',
          bitgoMsg2,
          commonPublicKeychain,
          encryptedState: 'backup-enc-state',
          encryptedStateKey: 'backup-enc-state-key',
        })
        .reply(200, {
          source: 'backup',
          commonKeychain: commonPublicKeychain,
        });

      const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
      const result = await callbacks.finalizeCallback({
        bitgoMsg2,
        commonPublicKeychain,
        userEncryptedState: 'user-enc-state',
        userEncryptedStateKey: 'user-enc-state-key',
        backupEncryptedState: 'backup-enc-state',
        backupEncryptedStateKey: 'backup-enc-state-key',
      });

      result.commonKeychain.should.equal(commonPublicKeychain);
      userFinalizeNock.done();
      backupFinalizeNock.done();
    });
  });
});
