import 'should';
import { config, isEnclavedConfig, TlsMode } from '../config';

describe('Configuration', () => {
  const originalEnv = process.env;
  const mockTlsKey = '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----';
  const mockTlsCert = '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----';

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear TLS-related environment variables
    delete process.env.TLS_MODE;
  });

  after(() => {
    process.env = originalEnv;
  });

  it('should throw error when APP_MODE is not set', () => {
    (() => config()).should.throw(
      'APP_MODE environment variable is required. Set APP_MODE to either "enclaved" or "master-express"',
    );
  });

  it('should throw error when APP_MODE is invalid', () => {
    process.env.APP_MODE = 'invalid';
    (() => config()).should.throw(
      'Invalid APP_MODE: invalid. Must be either "enclaved" or "master-express"',
    );
  });

  describe('Enclaved Mode', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'enclaved';
      process.env.KMS_URL = 'http://localhost:3000';
      // Set default TLS certificates
      process.env.TLS_KEY = mockTlsKey;
      process.env.TLS_CERT = mockTlsCert;
    });

    it('should use default configuration when no environment variables are set', () => {
      const cfg = config();
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
      const cfg = config();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.port.should.equal(4000);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read TLS mode from environment variables', () => {
      // Test with TLS disabled
      process.env.TLS_MODE = 'disabled';
      let cfg = config();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.DISABLED);
        cfg.kmsUrl.should.equal('http://localhost:3000');
      }

      // Test with mTLS explicitly enabled
      process.env.TLS_MODE = 'mtls';
      cfg = config();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }

      // Test with invalid TLS mode
      process.env.TLS_MODE = 'invalid';
      (() => config()).should.throw(
        'Invalid TLS_MODE: invalid. Must be either "disabled" or "mtls"',
      );

      // Test with no TLS mode (should default to MTLS)
      delete process.env.TLS_MODE;
      cfg = config();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.tlsMode.should.equal(TlsMode.MTLS);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }
    });

    it('should read mTLS settings from environment variables', () => {
      process.env.MTLS_REQUEST_CERT = 'true';
      process.env.MTLS_REJECT_UNAUTHORIZED = 'true';
      process.env.MTLS_ALLOWED_CLIENT_FINGERPRINTS = 'ABC123,DEF456';

      const cfg = config();
      isEnclavedConfig(cfg).should.be.true();
      if (isEnclavedConfig(cfg)) {
        cfg.mtlsRequestCert!.should.be.true();
        cfg.mtlsAllowedClientFingerprints!.should.deepEqual(['ABC123', 'DEF456']);
        cfg.kmsUrl.should.equal('http://localhost:3000');
        cfg.tlsKey!.should.equal(mockTlsKey);
        cfg.tlsCert!.should.equal(mockTlsCert);
      }
    });
  });
});
