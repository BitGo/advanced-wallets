import 'should';
import { initConfig, isEnclavedConfig, isMasterExpressConfig, TlsMode } from '../initConfig';
import path from 'path';

describe('Configuration', () => {
  const originalEnv = process.env;
  const mockTlsKey = '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----';
  const mockTlsCert = '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----';

  beforeEach(() => {
    // Reset to original environment and clear all relevant variables
    process.env = { ...originalEnv };
    delete process.env.APP_MODE;
    delete process.env.BITGO_APP_MODE;
    delete process.env.KMS_URL;
    delete process.env.ENCLAVED_EXPRESS_URL;
    delete process.env.ENCLAVED_EXPRESS_CERT;
    delete process.env.TLS_MODE;
    delete process.env.TLS_KEY;
    delete process.env.TLS_CERT;
    delete process.env.MTLS_ALLOWED_CLIENT_FINGERPRINTS;
    delete process.env.ALLOW_SELF_SIGNED;
    delete process.env.ENCLAVED_EXPRESS_PORT;
    delete process.env.MASTER_EXPRESS_PORT;
    delete process.env.BIND;
    delete process.env.IPC;
    delete process.env.LOGFILE;
    delete process.env.KEEP_ALIVE_TIMEOUT;
    delete process.env.HEADERS_TIMEOUT;
    delete process.env.BITGO_ENV;
    delete process.env.BITGO_CUSTOM_ROOT_URI;
    delete process.env.BITGO_DISABLE_ENV_CHECK;
    delete process.env.BITGO_AUTH_VERSION;
    delete process.env.BITGO_CUSTOM_BITCOIN_NETWORK;
    delete process.env.TLS_KEY_PATH;
    delete process.env.TLS_CERT_PATH;
  });

  after(() => {
    process.env = originalEnv;
  });

  it('should throw error when APP_MODE is not set', () => {
    (() => initConfig()).should.throw(
      'APP_MODE environment variable is required. Set APP_MODE to either "enclaved" or "master-express"',
    );
  });

  it('should throw error when APP_MODE is invalid', () => {
    process.env.APP_MODE = 'invalid';
    (() => initConfig()).should.throw(
      'Invalid APP_MODE: invalid. Must be either "enclaved" or "master-express"',
    );
  });

  describe('Enclaved Mode', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'enclaved';
    });

    it('should use default configuration when minimal environment variables are set', () => {
      process.env.KMS_URL = 'http://localhost:3000';
      process.env.TLS_KEY = mockTlsKey;
      process.env.TLS_CERT = mockTlsCert;
      const cfg = initConfig();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.port.should.equal(3080);
        cfg.bind.should.equal('localhost');
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.timeout.should.equal(305 * 1000);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read port from environment variable', () => {
      process.env.ENCLAVED_EXPRESS_PORT = '4000';
      process.env.KMS_URL = 'http://localhost:3000';
      process.env.TLS_KEY = mockTlsKey;
      process.env.TLS_CERT = mockTlsCert;
      const cfg = initConfig();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.port.should.equal(4000);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read TLS mode from environment variables', () => {
      process.env.KMS_URL = 'http://localhost:3000';
      process.env.TLS_KEY = mockTlsKey;
      process.env.TLS_CERT = mockTlsCert;

      // Test with TLS disabled
      process.env.TLS_MODE = 'disabled';
      let cfg = initConfig();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.kmsUrl.should.equal('http://localhost:3000');
      }

      // Test with mTLS explicitly enabled
      process.env.TLS_MODE = 'mtls';
      cfg = initConfig();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }

      // Test with invalid TLS mode
      process.env.TLS_MODE = 'invalid';
      (() => initConfig()).should.throw(
        'Invalid TLS_MODE: invalid. Must be either "disabled" or "mtls"',
      );

      // Test with no TLS mode (should default to MTLS)
      delete process.env.TLS_MODE;
      cfg = initConfig();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read mTLS settings from environment variables', () => {
      process.env.KMS_URL = 'http://localhost:3000';
      process.env.TLS_KEY = mockTlsKey;
      process.env.TLS_CERT = mockTlsCert;
      process.env.MTLS_ALLOWED_CLIENT_FINGERPRINTS = 'ABC123,DEF456';

      const cfg = initConfig();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.mtlsAllowedClientFingerprints!.should.deepEqual(['ABC123', 'DEF456']);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should throw error when KMS_URL is not set', () => {
      delete process.env.KMS_URL;
      (() => initConfig()).should.throw(
        'KMS_URL environment variable is required and cannot be empty',
      );
    });

    it('should throw error when KMS_URL is empty', () => {
      process.env.KMS_URL = '';
      (() => initConfig()).should.throw(
        'KMS_URL environment variable is required and cannot be empty',
      );
    });

    it('should succeed when TLS certificates are not set for disabled TLS mode', () => {
      process.env.KMS_URL = 'http://localhost:3000';
      process.env.TLS_MODE = 'disabled';
      delete process.env.TLS_KEY;
      delete process.env.TLS_CERT;
      const cfg = initConfig();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.kmsUrl.should.equal('http://localhost:3000');
      }
    });

    it('should throw error when TLS certificates are not set for MTLS mode', () => {
      process.env.KMS_URL = 'http://localhost:3000';
      process.env.TLS_MODE = 'mtls';
      delete process.env.TLS_KEY;
      delete process.env.TLS_CERT;
      (() => initConfig()).should.throw();
    });
  });

  describe('Master Express Mode', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'master-express';
      process.env.ENCLAVED_EXPRESS_URL = 'http://localhost:3080';
      process.env.ENCLAVED_EXPRESS_CERT = path.resolve(
        __dirname,
        'mocks/certs/enclaved-express-cert.pem',
      );
      process.env.TLS_CERT_PATH = path.resolve(__dirname, 'mocks/certs/test-ssl-cert.pem');
      process.env.TLS_KEY_PATH = path.resolve(__dirname, 'mocks/certs/test-ssl-key.pem');
    });

    it('should use default configuration when minimal environment variables are set', () => {
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.port.should.equal(3081);
        cfg.bind.should.equal('localhost');
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.timeout.should.equal(305 * 1000);
        cfg.enclavedExpressUrl.should.equal('https://localhost:3080');
        cfg.env.should.equal('test');
      }
    });

    it('should read port from environment variable', () => {
      process.env.MASTER_EXPRESS_PORT = '4001';
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.port.should.equal(4001);
        cfg.enclavedExpressUrl.should.equal('https://localhost:3080');
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
      delete process.env.ENCLAVED_EXPRESS_CERT;
      delete process.env.TLS_KEY_PATH;
      delete process.env.TLS_CERT_PATH;
      delete process.env.TLS_KEY;
      delete process.env.TLS_CERT;

      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.enclavedExpressUrl.should.equal('http://localhost:3080');
      }
    });

    it('should throw error when ENCLAVED_EXPRESS_URL is not set', () => {
      delete process.env.ENCLAVED_EXPRESS_URL;
      (() => initConfig()).should.throw(
        'ENCLAVED_EXPRESS_URL environment variable is required and cannot be empty',
      );
    });

    it('should throw error when ENCLAVED_EXPRESS_URL is empty', () => {
      process.env.ENCLAVED_EXPRESS_URL = '';
      (() => initConfig()).should.throw(
        'ENCLAVED_EXPRESS_URL environment variable is required and cannot be empty',
      );
    });

    it('should throw error when ENCLAVED_EXPRESS_CERT is not set for MTLS mode', () => {
      process.env.TLS_MODE = 'mtls';
      delete process.env.ENCLAVED_EXPRESS_CERT;
      (() => initConfig()).should.throw(
        'ENCLAVED_EXPRESS_CERT environment variable is required for MTLS mode.',
      );
    });

    it('should succeed when ENCLAVED_EXPRESS_CERT is not set for disabled TLS mode', () => {
      process.env.ENCLAVED_EXPRESS_URL = 'http://localhost:3080';
      process.env.TLS_MODE = 'disabled';
      delete process.env.ENCLAVED_EXPRESS_CERT;
      const cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.enclavedExpressUrl.should.equal('http://localhost:3080');
        cfg.enclavedExpressCert!.should.equal('');
      }
    });

    it('should throw error when ENCLAVED_EXPRESS_CERT is not set for default MTLS mode', () => {
      delete process.env.ENCLAVED_EXPRESS_CERT;
      (() => initConfig()).should.throw(
        'ENCLAVED_EXPRESS_CERT environment variable is required for MTLS mode.',
      );
    });

    it('should handle URL protocol conversion correctly', () => {
      // Test with URL that already has protocol
      process.env.ENCLAVED_EXPRESS_URL = 'https://enclaved.example.com:3080';
      let cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.enclavedExpressUrl.should.equal('https://enclaved.example.com:3080');
      }

      // Test with URL without protocol (should add https for MTLS)
      process.env.ENCLAVED_EXPRESS_URL = 'enclaved.example.com:3080';
      cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.enclavedExpressUrl.should.equal('https://enclaved.example.com:3080');
      }

      // Test with URL without protocol and disabled TLS (should add http)
      process.env.ENCLAVED_EXPRESS_URL = 'enclaved.example.com:3080';
      process.env.TLS_MODE = 'disabled';
      cfg = initConfig();
      isMasterExpressConfig(cfg).should.be.true();
      if (isMasterExpressConfig(cfg)) {
        cfg.enclavedExpressUrl.should.equal('http://enclaved.example.com:3080');
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
  });
});
