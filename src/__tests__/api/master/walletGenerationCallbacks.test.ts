import 'should';
import assert from 'assert';
import nock from 'nock';
import {
  createAwmBackupClient,
  createAwmClient,
  AdvancedWalletManagerClient,
} from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';
import { createOnchainKeyGenCallback } from '../../../masterBitgoExpress/handlers/walletGenerationCallbacks';
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
});
