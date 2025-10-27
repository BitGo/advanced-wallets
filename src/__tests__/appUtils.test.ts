import 'should';
import { createMtlsMiddleware } from '../shared/appUtils';
import { TlsMode } from '../initConfig';

describe('appUtils', () => {
  describe('createMtlsMiddleware', () => {
    describe('Empty mTLS fingerprint allowlist validation', () => {
      it('should reject connection when mTLS is enabled but fingerprint allowlist is empty', () => {
        const middleware = createMtlsMiddleware({
          tlsMode: TlsMode.MTLS,
          clientCertAllowSelfSigned: false,
          mtlsAllowedClientFingerprints: [],
        });

        const mockReq = {
          socket: {
            getPeerCertificate: () => ({
              subject: { CN: 'test-client' },
              issuer: { CN: 'test-ca', O: 'Test Org', OU: 'Test Unit' },
              fingerprint256: 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90',
            }),
          },
        } as any;

        const mockRes = {
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (body: any) {
            this.body = body;
            return this;
          },
          statusCode: 0,
          body: {},
        } as any;

        let nextCalled = false;
        const mockNext = () => {
          nextCalled = true;
        };

        middleware(mockReq, mockRes, mockNext);

        nextCalled.should.be.false();
        mockRes.statusCode.should.equal(403);
        mockRes.body.should.have.property('error', 'mTLS Authentication Failed');
        mockRes.body.should.have.property(
          'message',
          'No client certificate fingerprints configured',
        );
        mockRes.body.should.have
          .property('details')
          .match(/MTLS_ALLOWED_CLIENT_FINGERPRINTS must be configured/);
      });

      it('should reject connection when mTLS is enabled but fingerprint allowlist is undefined', () => {
        const middleware = createMtlsMiddleware({
          tlsMode: TlsMode.MTLS,
          clientCertAllowSelfSigned: false,
          mtlsAllowedClientFingerprints: undefined,
        });

        const mockReq = {
          socket: {
            getPeerCertificate: () => ({
              subject: { CN: 'test-client' },
              issuer: { CN: 'test-ca', O: 'Test Org', OU: 'Test Unit' },
              fingerprint256: 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90',
            }),
          },
        } as any;

        const mockRes = {
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (body: any) {
            this.body = body;
            return this;
          },
          statusCode: 0,
          body: {},
        } as any;

        let nextCalled = false;
        const mockNext = () => {
          nextCalled = true;
        };

        middleware(mockReq, mockRes, mockNext);

        nextCalled.should.be.false();
        mockRes.statusCode.should.equal(403);
        mockRes.body.should.have.property('error', 'mTLS Authentication Failed');
        mockRes.body.should.have.property(
          'message',
          'No client certificate fingerprints configured',
        );
      });

      it('should accept connection when mTLS is enabled and certificate is in allowlist', () => {
        const middleware = createMtlsMiddleware({
          tlsMode: TlsMode.MTLS,
          clientCertAllowSelfSigned: false,
          mtlsAllowedClientFingerprints: ['ABCDEF1234567890ABCDEF1234567890'],
        });

        const mockReq = {
          socket: {
            getPeerCertificate: () => ({
              subject: { CN: 'test-client' },
              issuer: { CN: 'test-ca', O: 'Test Org', OU: 'Test Unit' },
              fingerprint256: 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90',
            }),
          },
        } as any;

        const mockRes = {
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (body: any) {
            this.body = body;
            return this;
          },
          statusCode: 0,
          body: {},
        } as any;

        let nextCalled = false;
        const mockNext = () => {
          nextCalled = true;
        };

        middleware(mockReq, mockRes, mockNext);

        nextCalled.should.be.true();
        mockRes.statusCode.should.equal(0); // Status not set means success
      });

      it('should allow empty allowlist when TLS mode is disabled', () => {
        const middleware = createMtlsMiddleware({
          tlsMode: TlsMode.DISABLED,
          clientCertAllowSelfSigned: false,
          mtlsAllowedClientFingerprints: [],
        });

        const mockReq = {
          socket: {
            getPeerCertificate: () => ({
              subject: { CN: 'test-client' },
              issuer: { CN: 'test-ca', O: 'Test Org', OU: 'Test Unit' },
              fingerprint256: 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90',
            }),
          },
        } as any;

        const mockRes = {
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (body: any) {
            this.body = body;
            return this;
          },
          statusCode: 0,
          body: {},
        } as any;

        let nextCalled = false;
        const mockNext = () => {
          nextCalled = true;
        };

        middleware(mockReq, mockRes, mockNext);

        nextCalled.should.be.true();
        mockRes.statusCode.should.equal(0); // No rejection when TLS is disabled
      });
    });
  });
});
