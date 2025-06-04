import { config, isEnclavedConfig, TlsMode } from '../config';

describe('Configuration', () => {
  const originalEnv = process.env;
  const mockTlsKey = '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----';
  const mockTlsCert = '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear TLS-related environment variables
    delete process.env.TLS_MODE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw error when APP_MODE is not set', () => {
    expect(() => config()).toThrow('APP_MODE environment variable is required');
  });

  it('should throw error when APP_MODE is invalid', () => {
    process.env.APP_MODE = 'invalid';
    expect(() => config()).toThrow('Invalid APP_MODE: invalid');
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
      expect(isEnclavedConfig(cfg)).toBe(true);
      if (isEnclavedConfig(cfg)) {
        expect(cfg.port).toBe(3080);
        expect(cfg.bind).toBe('localhost');
        expect(cfg.tlsMode).toBe(TlsMode.MTLS);
        expect(cfg.timeout).toBe(305 * 1000);
        expect(cfg.kmsUrl).toBe('http://localhost:3000');
        expect(cfg.tlsKey).toBe(mockTlsKey);
        expect(cfg.tlsCert).toBe(mockTlsCert);
      }
    });

    it('should read port from environment variable', () => {
      process.env.ENCLAVED_EXPRESS_PORT = '4000';
      const cfg = config();
      expect(isEnclavedConfig(cfg)).toBe(true);
      if (isEnclavedConfig(cfg)) {
        expect(cfg.port).toBe(4000);
        expect(cfg.kmsUrl).toBe('http://localhost:3000');
        expect(cfg.tlsKey).toBe(mockTlsKey);
        expect(cfg.tlsCert).toBe(mockTlsCert);
      }
    });

    it('should read TLS mode from environment variables', () => {
      // Test with TLS disabled
      process.env.TLS_MODE = 'disabled';
      let cfg = config();
      expect(isEnclavedConfig(cfg)).toBe(true);
      if (isEnclavedConfig(cfg)) {
        expect(cfg.tlsMode).toBe(TlsMode.DISABLED);
        expect(cfg.kmsUrl).toBe('http://localhost:3000');
      }

      // Test with mTLS explicitly enabled
      process.env.TLS_MODE = 'mtls';
      cfg = config();
      expect(isEnclavedConfig(cfg)).toBe(true);
      if (isEnclavedConfig(cfg)) {
        expect(cfg.tlsMode).toBe(TlsMode.MTLS);
        expect(cfg.kmsUrl).toBe('http://localhost:3000');
        expect(cfg.tlsKey).toBe(mockTlsKey);
        expect(cfg.tlsCert).toBe(mockTlsCert);
      }

      // Test with invalid TLS mode
      process.env.TLS_MODE = 'invalid';
      expect(() => config()).toThrow('Invalid TLS_MODE: invalid');

      // Test with no TLS mode (should default to MTLS)
      delete process.env.TLS_MODE;
      cfg = config();
      expect(isEnclavedConfig(cfg)).toBe(true);
      if (isEnclavedConfig(cfg)) {
        expect(cfg.tlsMode).toBe(TlsMode.MTLS);
        expect(cfg.kmsUrl).toBe('http://localhost:3000');
        expect(cfg.tlsKey).toBe(mockTlsKey);
        expect(cfg.tlsCert).toBe(mockTlsCert);
      }
    });

    it('should read mTLS settings from environment variables', () => {
      process.env.MTLS_REQUEST_CERT = 'true';
      process.env.MTLS_REJECT_UNAUTHORIZED = 'true';
      process.env.MTLS_ALLOWED_CLIENT_FINGERPRINTS = 'ABC123,DEF456';

      const cfg = config();
      expect(isEnclavedConfig(cfg)).toBe(true);
      if (isEnclavedConfig(cfg)) {
        expect(cfg.mtlsRequestCert).toBe(true);
        expect(cfg.mtlsAllowedClientFingerprints).toEqual(['ABC123', 'DEF456']);
        expect(cfg.kmsUrl).toBe('http://localhost:3000');
        expect(cfg.tlsKey).toBe(mockTlsKey);
        expect(cfg.tlsCert).toBe(mockTlsCert);
      }
    });
  });
});
