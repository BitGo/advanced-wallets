import 'should';
import {
  initConfig,
  isAdvancedWalletManagerConfig,
  isMasterExpressConfig,
  TlsMode,
  SigningMode,
} from '../initConfig';
import path from 'path';

describe('Configuration', () => {
  const originalEnv = process.env;
  const mockTlsKey = '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----';
  const mockTlsCert = '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----';
  const mockClientTlsKey =
    '-----BEGIN PRIVATE KEY-----\nMOCK_CLIENT_KEY\n-----END PRIVATE KEY-----';
  const mockClientTlsCert =
    '-----BEGIN CERTIFICATE-----\nMOCK_CLIENT_CERT\n-----END CERTIFICATE-----';

  beforeEach(() => {
    // Reset to original environment and clear all relevant variables
    process.env = { ...originalEnv };
    delete process.env.APP_MODE;
    delete process.env.BITGO_APP_MODE;
    delete process.env.KEY_PROVIDER_URL;
    delete process.env.ADVANCED_WALLET_MANAGER_URL;
    delete process.env.AWM_SERVER_CA_CERT_PATH;
    delete process.env.TLS_MODE;
    delete process.env.SERVER_TLS_KEY;
    delete process.env.SERVER_TLS_CERT;
    delete process.env.MTLS_ALLOWED_CLIENT_FINGERPRINTS;
    delete process.env.CLIENT_CERT_ALLOW_SELF_SIGNED;
    delete process.env.ADVANCED_WALLET_MANAGER_PORT;
    delete process.env.MASTER_EXPRESS_PORT;
    delete process.env.BIND;
    delete process.env.IPC;
    delete process.env.HTTP_LOGFILE;
    delete process.env.KEEP_ALIVE_TIMEOUT;
    delete process.env.HEADERS_TIMEOUT;
    delete process.env.BITGO_ENV;
    delete process.env.BITGO_CUSTOM_ROOT_URI;
    delete process.env.BITGO_DISABLE_ENV_CHECK;
    delete process.env.BITGO_AUTH_VERSION;
    delete process.env.BITGO_CUSTOM_BITCOIN_NETWORK;
    delete process.env.SERVER_TLS_KEY_PATH;
    delete process.env.SERVER_TLS_CERT_PATH;
    delete process.env.KEY_PROVIDER_CLIENT_TLS_KEY;
    delete process.env.KEY_PROVIDER_CLIENT_TLS_CERT;
    delete process.env.KEY_PROVIDER_CLIENT_TLS_KEY_PATH;
    delete process.env.KEY_PROVIDER_CLIENT_TLS_CERT_PATH;
    delete process.env.AWM_CLIENT_TLS_KEY;
    delete process.env.AWM_CLIENT_TLS_CERT;
    delete process.env.AWM_CLIENT_TLS_KEY_PATH;
    delete process.env.AWM_CLIENT_TLS_CERT_PATH;
    delete process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH;
    delete process.env.RECOVERY_MODE;
    delete process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL;
    delete process.env.AWM_BACKUP_SERVER_CA_CERT_PATH;
    delete process.env.AWM_BACKUP_CLIENT_TLS_KEY_PATH;
    delete process.env.AWM_BACKUP_CLIENT_TLS_CERT_PATH;
    delete process.env.AWM_BACKUP_CLIENT_TLS_KEY;
    delete process.env.AWM_BACKUP_CLIENT_TLS_CERT;
    delete process.env.ASYNC_MODE;
    delete process.env.AWM_ASYNC_URL;
    delete process.env.MBE_POLL_INTERVAL_MS;
    delete process.env.MBE_JOB_TTL_S;
    delete process.env.MBE_JOB_TTL_MPC_S;
  });

  after(() => {
    process.env = originalEnv;
  });

  it('should throw error when APP_MODE is not set', () => {
    (() => initConfig()).should.throw(
      'APP_MODE environment variable is required. Set APP_MODE to either "advanced-wallet-manager" or "master-express"',
    );
  });

  it('should throw error when APP_MODE is invalid', () => {
    process.env.APP_MODE = 'invalid';
    (() => initConfig()).should.throw(
      'Invalid APP_MODE: invalid. Must be either "advanced-wallet-manager" or "master-express"',
    );
  });

  describe('Advanced Wallet Manager Mode', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'advanced-wallet-manager';
    });

    it('should use default configuration when minimal environment variables are set', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.SERVER_TLS_KEY = mockTlsKey;
      process.env.SERVER_TLS_CERT = mockTlsCert;
      process.env.KEY_PROVIDER_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.KEY_PROVIDER_CLIENT_TLS_CERT = mockClientTlsCert;
      process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/test-ssl-cert.pem',
      );
      const cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.port.should.equal(3080);
        cfg.bind.should.equal('localhost');
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.timeout.should.equal(305 * 1000);
        cfg.keyProviderUrl.should.equal('http://localhost:3000');
        cfg.serverTlsKey!.should.equal(mockTlsKey);
        cfg.serverTlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read port from environment variable', () => {
      process.env.ADVANCED_WALLET_MANAGER_PORT = '4000';
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.SERVER_TLS_KEY = mockTlsKey;
      process.env.SERVER_TLS_CERT = mockTlsCert;
      process.env.KEY_PROVIDER_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.KEY_PROVIDER_CLIENT_TLS_CERT = mockClientTlsCert;
      process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/test-ssl-cert.pem',
      );
      const cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.port.should.equal(4000);
        cfg.keyProviderUrl.should.equal('http://localhost:3000');
        cfg.serverTlsKey!.should.equal(mockTlsKey);
        cfg.serverTlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read the recovery mode from the env', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.SERVER_TLS_KEY = mockTlsKey;
      process.env.SERVER_TLS_CERT = mockTlsCert;
      process.env.KEY_PROVIDER_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.KEY_PROVIDER_CLIENT_TLS_CERT = mockClientTlsCert;
      process.env.RECOVERY_MODE = 'true';
      process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/test-ssl-cert.pem',
      );
      const cfg = initConfig();
      cfg.recoveryMode!.should.be.true();
    });

    it('should read TLS mode from environment variables', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.SERVER_TLS_KEY = mockTlsKey;
      process.env.SERVER_TLS_CERT = mockTlsCert;
      process.env.KEY_PROVIDER_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.KEY_PROVIDER_CLIENT_TLS_CERT = mockClientTlsCert;
      process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/test-ssl-cert.pem',
      );

      // Test with TLS disabled
      process.env.TLS_MODE = 'disabled';
      let cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.keyProviderUrl.should.equal('http://localhost:3000');
      }

      // Test with mTLS explicitly enabled
      process.env.TLS_MODE = 'mtls';
      cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.keyProviderUrl.should.equal('http://localhost:3000');
        cfg.serverTlsKey!.should.equal(mockTlsKey);
        cfg.serverTlsCert!.should.equal(mockTlsCert);
      }

      // Test with invalid TLS mode
      process.env.TLS_MODE = 'invalid';
      (() => initConfig()).should.throw(
        'Invalid TLS_MODE: invalid. Must be either "disabled" or "mtls"',
      );

      // Test with no TLS mode (should default to MTLS)
      delete process.env.TLS_MODE;
      cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.keyProviderUrl.should.equal('http://localhost:3000');
        cfg.serverTlsKey!.should.equal(mockTlsKey);
        cfg.serverTlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read SIGNING_MODE from environment variables', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.TLS_MODE = 'disabled';

      // unset defaults to LOCAL
      delete process.env.SIGNING_MODE;
      let cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.should.have.property('signingMode', SigningMode.LOCAL);
      }

      // explicit external
      process.env.SIGNING_MODE = 'external';
      cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.should.have.property('signingMode', SigningMode.EXTERNAL);
      }

      // invalid value throws
      process.env.SIGNING_MODE = 'invalid';
      (() => initConfig()).should.throw(
        'Invalid SIGNING_MODE: invalid. Must be one of: local, external',
      );

      delete process.env.SIGNING_MODE;
    });

    it('should read mTLS settings from environment variables', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.SERVER_TLS_KEY = mockTlsKey;
      process.env.SERVER_TLS_CERT = mockTlsCert;
      process.env.KEY_PROVIDER_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.KEY_PROVIDER_CLIENT_TLS_CERT = mockClientTlsCert;
      process.env.MTLS_ALLOWED_CLIENT_FINGERPRINTS = 'ABC123,DEF456';
      process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/test-ssl-cert.pem',
      );

      const cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.mtlsAllowedClientFingerprints!.should.deepEqual(['ABC123', 'DEF456']);
        cfg.keyProviderUrl.should.equal('http://localhost:3000');
        cfg.serverTlsKey!.should.equal(mockTlsKey);
        cfg.serverTlsCert!.should.equal(mockTlsCert);
        cfg.keyProviderServerCaCertPath!.should.equal(
          path.resolve(__dirname, 'mocks/certs/test-ssl-cert.pem'),
        );
      }
    });

    it('should throw error when KEY_PROVIDER_URL is not set', () => {
      delete process.env.KEY_PROVIDER_URL;
      (() => initConfig()).should.throw(
        'KEY_PROVIDER_URL environment variable is required and cannot be empty',
      );
    });

    it('should throw error when KEY_PROVIDER_URL is empty', () => {
      process.env.KEY_PROVIDER_URL = '';
      (() => initConfig()).should.throw(
        'KEY_PROVIDER_URL environment variable is required and cannot be empty',
      );
    });

    it('should succeed when TLS certificates are not set for disabled TLS mode', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.TLS_MODE = 'disabled';
      delete process.env.SERVER_TLS_KEY;
      delete process.env.SERVER_TLS_CERT;
      delete process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH;
      const cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.keyProviderUrl.should.equal('http://localhost:3000');
      }
    });

    it('should throw error when TLS certificates are not set for MTLS mode', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.TLS_MODE = 'mtls';
      delete process.env.SERVER_TLS_KEY;
      delete process.env.SERVER_TLS_CERT;
      (() => initConfig()).should.throw();
    });

    it('should read HTTP_LOGFILE into httpLoggerFile in Advanced wallet manager mode', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.SERVER_TLS_KEY = mockTlsKey;
      process.env.SERVER_TLS_CERT = mockTlsCert;
      process.env.KEY_PROVIDER_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.KEY_PROVIDER_CLIENT_TLS_CERT = mockClientTlsCert;
      process.env.HTTP_LOGFILE = '/tmp/test-http-access.log';
      process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/test-ssl-cert.pem',
      );
      const cfg = initConfig();
      isAdvancedWalletManagerConfig(cfg).should.be.true();
      if (isAdvancedWalletManagerConfig(cfg)) {
        cfg.httpLoggerFile.should.equal('/tmp/test-http-access.log');
      }
    });

    it('should throw error when KEY_PROVIDER_SERVER_CA_CERT_PATH is not set for MTLS mode', () => {
      process.env.KEY_PROVIDER_URL = 'http://localhost:3000';
      process.env.TLS_MODE = 'mtls';
      delete process.env.KEY_PROVIDER_SERVER_CA_CERT_PATH;
      (() => initConfig()).should.throw(
        'KEY_PROVIDER_SERVER_CA_CERT_PATH is required when TLS mode is MTLS',
      );
    });
  });

  describe('Master Express Mode', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'master-express';
      process.env.ADVANCED_WALLET_MANAGER_URL = 'http://localhost:3080';
      process.env.AWM_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.SERVER_TLS_CERT_PATH = path.resolve(__dirname, 'mocks/certs/test-ssl-cert.pem');
      process.env.SERVER_TLS_KEY_PATH = path.resolve(__dirname, 'mocks/certs/test-ssl-key.pem');
      process.env.AWM_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.AWM_CLIENT_TLS_CERT = mockClientTlsCert;
    });

    it('should use default configuration when minimal environment variables are set', () => {
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.port.should.equal(3081);
        cfg.bind.should.equal('localhost');
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.timeout.should.equal(305 * 1000);
        cfg.advancedWalletManagerUrl.should.equal('https://localhost:3080');
        cfg.env.should.equal('test');
      }
    });

    it('should read port from environment variable', () => {
      process.env.MASTER_EXPRESS_PORT = '4001';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.port.should.equal(4001);
        cfg.advancedWalletManagerUrl.should.equal('https://localhost:3080');
      }
    });

    it('should read BitGo environment settings', () => {
      process.env.BITGO_ENV = 'prod';
      process.env.BITGO_CUSTOM_ROOT_URI = 'https://custom.bitgo.com';
      process.env.BITGO_DISABLE_ENV_CHECK = 'false';
      process.env.BITGO_AUTH_VERSION = '3';
      process.env.BITGO_CUSTOM_BITCOIN_NETWORK = 'testnet';

      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.env.should.equal('prod');
        cfg.customRootUri!.should.equal('https://custom.bitgo.com');
        cfg.disableEnvCheck!.should.be.false();
        cfg.authVersion!.should.equal(3);
        cfg.customBitcoinNetwork!.should.equal('testnet');
      }
    });

    it('should handle TLS mode disabled configuration', () => {
      // Test with TLS disabled
      process.env.TLS_MODE = 'disabled';
      delete process.env.AWM_SERVER_CA_CERT_PATH;
      delete process.env.SERVER_TLS_KEY_PATH;
      delete process.env.SERVER_TLS_CERT_PATH;
      delete process.env.SERVER_TLS_KEY;
      delete process.env.SERVER_TLS_CERT;

      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.advancedWalletManagerUrl.should.equal('http://localhost:3080');
      }
    });

    it('should throw error when ADVANCED_WALLET_MANAGER_URL is not set', () => {
      delete process.env.ADVANCED_WALLET_MANAGER_URL;
      (() => initConfig()).should.throw(
        'ADVANCED_WALLET_MANAGER_URL environment variable is required and cannot be empty',
      );
    });

    it('should throw error when ADVANCED_WALLET_MANAGER_URL is empty', () => {
      process.env.ADVANCED_WALLET_MANAGER_URL = '';
      (() => initConfig()).should.throw(
        'ADVANCED_WALLET_MANAGER_URL environment variable is required and cannot be empty',
      );
    });

    it('should throw error when AWM_SERVER_CA_CERT_PATH is not set for MTLS mode', () => {
      process.env.TLS_MODE = 'mtls';
      delete process.env.AWM_SERVER_CA_CERT_PATH;
      (() => initConfig()).should.throw(
        'AWM_SERVER_CA_CERT_PATH environment variable is required for MTLS mode.',
      );
    });

    it('should succeed when AWM_SERVER_CA_CERT_PATH is not set for disabled TLS mode', () => {
      process.env.ADVANCED_WALLET_MANAGER_URL = 'http://localhost:3080';
      process.env.TLS_MODE = 'disabled';
      delete process.env.AWM_SERVER_CA_CERT_PATH;
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.advancedWalletManagerUrl.should.equal('http://localhost:3080');
        (cfg.awmServerCaCert === undefined).should.be.true();
      }
    });

    it('should throw error when AWM_SERVER_CA_CERT_PATH is not set for default MTLS mode', () => {
      delete process.env.AWM_SERVER_CA_CERT_PATH;
      (() => initConfig()).should.throw(
        'AWM_SERVER_CA_CERT_PATH environment variable is required for MTLS mode.',
      );
    });

    it('should handle URL protocol conversion correctly', () => {
      // Test with URL that already has protocol
      process.env.ADVANCED_WALLET_MANAGER_URL = 'https://akm.example.com:3080';
      let cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.advancedWalletManagerUrl.should.equal('https://akm.example.com:3080');
      }

      // Test with URL without protocol (should add https for MTLS)
      process.env.ADVANCED_WALLET_MANAGER_URL = 'akm.example.com:3080';
      cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.advancedWalletManagerUrl.should.equal('https://akm.example.com:3080');
      }

      // Test with URL without protocol and disabled TLS (should add http)
      process.env.ADVANCED_WALLET_MANAGER_URL = 'akm.example.com:3080';
      process.env.TLS_MODE = 'disabled';
      cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.advancedWalletManagerUrl.should.equal('http://akm.example.com:3080');
      }
    });

    it('should handle custom BitGo root URI protocol conversion', () => {
      process.env.BITGO_CUSTOM_ROOT_URI = 'bitgo.example.com';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.customRootUri!.should.equal('https://bitgo.example.com');
      }
    });

    it('should read HTTP_LOGFILE into httpLoggerFile in Master Express mode', () => {
      process.env.HTTP_LOGFILE = '/tmp/test-http-access.log';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.httpLoggerFile.should.equal('/tmp/test-http-access.log');
      }
    });

    it('should not set backup URL when ADVANCED_WALLET_MANAGER_BACKUP_URL is not set', () => {
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        (cfg.advancedWalletManagerBackupUrl === undefined).should.be.true();
      }
    });

    it('should read and protocol-process backup URL when configured', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.AWM_BACKUP_CLIENT_TLS_CERT = mockClientTlsCert;
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.advancedWalletManagerBackupUrl!.should.equal('https://backup-awm.example.com:3080');
      }
    });

    it('should use http protocol for backup URL when TLS is disabled', () => {
      process.env.TLS_MODE = 'disabled';
      delete process.env.AWM_SERVER_CA_CERT_PATH;
      delete process.env.SERVER_TLS_KEY_PATH;
      delete process.env.SERVER_TLS_CERT_PATH;
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.advancedWalletManagerBackupUrl!.should.equal('http://backup-awm.example.com:3080');
      }
    });

    it('should throw error when backup URL is set without AWM_BACKUP_SERVER_CA_CERT_PATH in MTLS mode', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'https://backup-awm.example.com:3080';
      (() => initConfig()).should.throw(
        'AWM_BACKUP_SERVER_CA_CERT_PATH environment variable is required for MTLS mode when provisioning a backup AWM URL.',
      );
    });

    it('should load backup server CA cert from file', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.AWM_BACKUP_CLIENT_TLS_CERT = mockClientTlsCert;
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.awmBackupServerCaCert!.should.be.a.String();
        cfg.awmBackupServerCaCert!.length.should.be.greaterThan(0);
      }
    });

    it('should not require backup cert paths when backup URL is not set in MTLS mode', () => {
      // This verifies backward compatibility — no backup URL means no backup cert validation
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        (cfg.advancedWalletManagerBackupUrl === undefined).should.be.true();
        (cfg.awmBackupServerCaCert === undefined).should.be.true();
      }
    });

    it('should load backup client TLS key from file path', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_KEY_PATH = path.resolve(
        __dirname,
        'mocks/certs/client.key',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_CERT = mockClientTlsCert;
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.awmBackupClientTlsKey!.should.be.a.String();
        cfg.awmBackupClientTlsKey!.length.should.be.greaterThan(0);
      }
    });

    it('should load backup client TLS cert from file path', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.AWM_BACKUP_CLIENT_TLS_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/client.crt',
      );
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.awmBackupClientTlsCert!.should.be.a.String();
        cfg.awmBackupClientTlsCert!.length.should.be.greaterThan(0);
      }
    });

    it('should throw error when backup client TLS key path points to a nonexistent file', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_KEY_PATH = '/nonexistent/path/client.key';
      (() => initConfig()).should.throw(/Failed to read AWM backup client key/);
    });

    it('should throw error when backup client TLS cert path points to a nonexistent file', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_CERT_PATH = '/nonexistent/path/client.crt';
      (() => initConfig()).should.throw(/Failed to read AWM backup client cert/);
    });

    it('should throw error when backup URL is set in mTLS mode but no backup or primary client certs are available', () => {
      // Remove primary client certs so fallback also fails
      delete process.env.AWM_CLIENT_TLS_KEY;
      delete process.env.AWM_CLIENT_TLS_CERT;
      delete process.env.AWM_CLIENT_TLS_KEY_PATH;
      delete process.env.AWM_CLIENT_TLS_CERT_PATH;
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      // Primary cert validation fires first since both primary and backup certs are missing
      (() => initConfig()).should.throw(
        /AWM_CLIENT_TLS_KEY_PATH and AWM_CLIENT_TLS_CERT_PATH.*are required for outbound mTLS connections to Advanced Wallet Manager/,
      );
    });

    it('should succeed when backup URL is set in mTLS mode and dedicated backup client certs are provided', () => {
      process.env.ADVANCED_WALLET_MANAGER_BACKUP_URL = 'backup-awm.example.com:3080';
      process.env.AWM_BACKUP_SERVER_CA_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/advanced-wallet-manager-cert.pem',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_KEY = mockClientTlsKey;
      process.env.AWM_BACKUP_CLIENT_TLS_CERT = mockClientTlsCert;
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.advancedWalletManagerBackupUrl!.should.be.a.String();
      }
    });

    it('should not load backup client certs from file when backup URL is not set', () => {
      process.env.TLS_MODE = 'disabled';
      delete process.env.AWM_SERVER_CA_CERT_PATH;
      delete process.env.SERVER_TLS_KEY_PATH;
      delete process.env.SERVER_TLS_CERT_PATH;
      process.env.AWM_BACKUP_CLIENT_TLS_KEY_PATH = path.resolve(
        __dirname,
        'mocks/certs/client.key',
      );
      process.env.AWM_BACKUP_CLIENT_TLS_CERT_PATH = path.resolve(
        __dirname,
        'mocks/certs/client.crt',
      );
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        // Paths are stored in config but files are not loaded without a backup URL
        (cfg.advancedWalletManagerBackupUrl === undefined).should.be.true();
        (cfg.awmBackupClientTlsKey === undefined).should.be.true();
        (cfg.awmBackupClientTlsCert === undefined).should.be.true();
      }
    });

    it('should default asyncModeConfig to disabled with default values', () => {
      process.env.TLS_MODE = 'disabled';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.asyncModeConfig.enabled.should.be.false();
        cfg.asyncModeConfig.awmAsyncUrl.should.equal('');
        cfg.asyncModeConfig.pollIntervalInMs.should.equal(30000);
        cfg.asyncModeConfig.jobTtlInSeconds.should.equal(3600);
        cfg.asyncModeConfig.jobTtlMpcInSeconds.should.equal(7200);
      }
    });

    it('should load asyncModeConfig from env vars when ASYNC_MODE is true', () => {
      process.env.TLS_MODE = 'disabled';
      process.env.ASYNC_MODE = 'true';
      process.env.AWM_ASYNC_URL = 'http://awm-async:8080';
      process.env.MBE_POLL_INTERVAL_MS = '5000';
      process.env.MBE_JOB_TTL_S = '1800';
      process.env.MBE_JOB_TTL_MPC_S = '3600';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.asyncModeConfig.enabled.should.be.true();
        cfg.asyncModeConfig.awmAsyncUrl.should.equal('http://awm-async:8080');
        cfg.asyncModeConfig.pollIntervalInMs.should.equal(5000);
        cfg.asyncModeConfig.jobTtlInSeconds.should.equal(1800);
        cfg.asyncModeConfig.jobTtlMpcInSeconds.should.equal(3600);
      }
    });

    it('should use default numeric values when async mode numeric env vars are not set', () => {
      process.env.TLS_MODE = 'disabled';
      process.env.ASYNC_MODE = 'true';
      process.env.AWM_ASYNC_URL = 'http://awm-async:8080';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.asyncModeConfig.pollIntervalInMs.should.equal(30000);
        cfg.asyncModeConfig.jobTtlInSeconds.should.equal(3600);
        cfg.asyncModeConfig.jobTtlMpcInSeconds.should.equal(7200);
      }
    });

    it('should throw when ASYNC_MODE is true but AWM_ASYNC_URL is missing', () => {
      process.env.TLS_MODE = 'disabled';
      process.env.ASYNC_MODE = 'true';
      (() => initConfig()).should.throw('AWM_ASYNC_URL is required when ASYNC_MODE is true');
    });

    it('should allow missing ADVANCED_WALLET_MANAGER_URL when ASYNC_MODE is true', () => {
      process.env.TLS_MODE = 'disabled';
      process.env.ASYNC_MODE = 'true';
      process.env.AWM_ASYNC_URL = 'http://awm-async:8080';
      delete process.env.ADVANCED_WALLET_MANAGER_URL;
      (() => initConfig()).should.not.throw();
    });

    it('should throw when MBE_POLL_INTERVAL_MS is negative', () => {
      process.env.TLS_MODE = 'disabled';
      process.env.ASYNC_MODE = 'true';
      process.env.AWM_ASYNC_URL = 'http://awm-async:8080';
      process.env.MBE_POLL_INTERVAL_MS = '-1';
      (() => initConfig()).should.throw('MBE_POLL_INTERVAL_MS must be a positive number, got -1');
    });

    it('should throw when MBE_JOB_TTL_S is negative', () => {
      process.env.TLS_MODE = 'disabled';
      process.env.ASYNC_MODE = 'true';
      process.env.AWM_ASYNC_URL = 'http://awm-async:8080';
      process.env.MBE_JOB_TTL_S = '-1';
      (() => initConfig()).should.throw('MBE_JOB_TTL_S must be a positive number, got -1');
    });

    it('should throw when MBE_JOB_TTL_MPC_S is negative', () => {
      process.env.TLS_MODE = 'disabled';
      process.env.ASYNC_MODE = 'true';
      process.env.AWM_ASYNC_URL = 'http://awm-async:8080';
      process.env.MBE_JOB_TTL_MPC_S = '-1';
      (() => initConfig()).should.throw('MBE_JOB_TTL_MPC_S must be a positive number, got -1');
    });
  });
});
