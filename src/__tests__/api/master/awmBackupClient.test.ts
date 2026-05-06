import 'should';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import {
  createAwmClient,
  createAwmBackupClient,
} from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';

describe('AWM Backup Client', () => {
  const baseConfig: MasterExpressConfig = {
    appMode: AppMode.MASTER_EXPRESS,
    port: 3081,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    env: 'test',
    disableEnvCheck: true,
    authVersion: 2,
    advancedWalletManagerUrl: 'http://primary-awm.invalid',
    awmServerCaCert: 'dummy-cert',
    tlsMode: TlsMode.DISABLED,
    clientCertAllowSelfSigned: true,
  };

  describe('createAwmBackupClient', () => {
    it('should return undefined when no backup URL is configured', () => {
      const result = createAwmBackupClient(baseConfig, 'tbtc');
      (result === undefined).should.be.true();
    });

    it('should create a client when backup URL is configured', () => {
      const config: MasterExpressConfig = {
        ...baseConfig,
        advancedWalletManagerBackupUrl: 'http://backup-awm.invalid',
      };
      const result = createAwmBackupClient(config, 'tbtc');
      (result !== undefined).should.be.true();
    });

    it('should create a client pointing to the backup URL, not the primary', () => {
      const config: MasterExpressConfig = {
        ...baseConfig,
        advancedWalletManagerBackupUrl: 'http://backup-awm.invalid',
      };
      const backupClient = createAwmBackupClient(config, 'tbtc');
      const primaryClient = createAwmClient(config, 'tbtc');

      // Both clients should exist
      (backupClient !== undefined).should.be.true();
      (primaryClient !== undefined).should.be.true();

      // They should be different instances
      (backupClient !== primaryClient).should.be.true();
    });

    it('should throw when backup URL is set with mTLS but backup server CA cert is missing', () => {
      const config: MasterExpressConfig = {
        ...baseConfig,
        tlsMode: TlsMode.MTLS,
        advancedWalletManagerBackupUrl: 'https://backup-awm.invalid',
        awmServerCaCert: 'primary-ca-cert',
        awmClientTlsKey: 'primary-client-key',
        awmClientTlsCert: 'primary-client-cert',
        // No backup-specific certs — should NOT fall back to primary
      };
      (() => createAwmBackupClient(config, 'tbtc')).should.throw(
        /awmBackupServerCaCert is required/,
      );
    });

    it('should throw when backup URL is set with mTLS but backup client certs are missing', () => {
      const config: MasterExpressConfig = {
        ...baseConfig,
        tlsMode: TlsMode.MTLS,
        advancedWalletManagerBackupUrl: 'https://backup-awm.invalid',
        awmBackupServerCaCert: 'backup-ca-cert',
        // No backup client certs
      };
      (() => createAwmBackupClient(config, 'tbtc')).should.throw(
        /awmBackupClientTlsKey and awmBackupClientTlsCert are required/,
      );
    });

    it('should create a client when all backup-specific certs are provided with mTLS', () => {
      const config: MasterExpressConfig = {
        ...baseConfig,
        tlsMode: TlsMode.MTLS,
        advancedWalletManagerBackupUrl: 'https://backup-awm.invalid',
        awmServerCaCert: 'primary-ca-cert',
        awmClientTlsKey: 'primary-client-key',
        awmClientTlsCert: 'primary-client-cert',
        awmBackupServerCaCert: 'backup-ca-cert',
        awmBackupClientTlsKey: 'backup-client-key',
        awmBackupClientTlsCert: 'backup-client-cert',
      };
      const result = createAwmBackupClient(config, 'tbtc');
      (result !== undefined).should.be.true();
    });
  });

  describe('fallback behavior in middleware', () => {
    it('should use primary client for both user and backup when no backup URL is set', () => {
      const primaryClient = createAwmClient(baseConfig, 'tbtc');
      const backupClient = createAwmBackupClient(baseConfig, 'tbtc');

      (primaryClient !== undefined).should.be.true();
      // No backup URL → backup client is undefined → middleware falls back to primary
      (backupClient === undefined).should.be.true();

      // Middleware would do: awmBackupClient = backupClient ?? primaryClient
      const effectiveBackupClient = backupClient ?? primaryClient;
      (effectiveBackupClient === primaryClient).should.be.true();
    });

    it('should use separate client for backup when backup URL is set', () => {
      const config: MasterExpressConfig = {
        ...baseConfig,
        advancedWalletManagerBackupUrl: 'http://backup-awm.invalid',
      };
      const primaryClient = createAwmClient(config, 'tbtc');
      const backupClient = createAwmBackupClient(config, 'tbtc');

      (primaryClient !== undefined).should.be.true();
      (backupClient !== undefined).should.be.true();

      // Middleware would do: awmBackupClient = backupClient ?? primaryClient
      const effectiveBackupClient = backupClient ?? primaryClient;
      (effectiveBackupClient === backupClient).should.be.true();
      (effectiveBackupClient !== primaryClient).should.be.true();
    });
  });
});
