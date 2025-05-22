import { config, TlsMode } from '../config';

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Explicitly clear MTLS-related environment variables
    delete process.env.MTLS_ENABLED;
    delete process.env.MASTER_BITGO_EXPRESS_DISABLE_TLS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use default configuration when no environment variables are set', () => {
    const cfg = config();
    expect(cfg.port).toBe(3080);
    expect(cfg.bind).toBe('localhost');
    expect(cfg.tlsMode).toBe(TlsMode.ENABLED);
    expect(cfg.timeout).toBe(305 * 1000);
  });

  it('should read port from environment variable', () => {
    process.env.MASTER_BITGO_EXPRESS_PORT = '4000';
    const cfg = config();
    expect(cfg.port).toBe(4000);
  });

  it('should read TLS mode from environment variables', () => {
    process.env.MASTER_BITGO_EXPRESS_DISABLE_TLS = 'true';
    let cfg = config();
    expect(cfg.tlsMode).toBe(TlsMode.DISABLED);

    process.env.MASTER_BITGO_EXPRESS_DISABLE_TLS = 'false';
    process.env.MTLS_ENABLED = 'true';
    cfg = config();
    expect(cfg.tlsMode).toBe(TlsMode.MTLS);
  });

  it('should throw error when both TLS disabled and mTLS enabled', () => {
    process.env.MASTER_BITGO_EXPRESS_DISABLE_TLS = 'true';
    process.env.MTLS_ENABLED = 'true';
    expect(() => config()).toThrow('Cannot have both TLS disabled and mTLS enabled');
  });

  it('should read mTLS settings from environment variables', () => {
    process.env.MTLS_ENABLED = 'true';
    process.env.MTLS_REQUEST_CERT = 'true';
    process.env.MTLS_REJECT_UNAUTHORIZED = 'true';
    process.env.MTLS_ALLOWED_CLIENT_FINGERPRINTS = 'ABC123,DEF456';

    const cfg = config();
    expect(cfg.mtlsRequestCert).toBe(true);
    expect(cfg.mtlsRejectUnauthorized).toBe(true);
    expect(cfg.mtlsAllowedClientFingerprints).toEqual(['ABC123', 'DEF456']);
  });
});
