/**
 * @prettier
 */
export enum TlsMode {
  DISABLED = 'disabled', // No TLS (plain HTTP)
  ENABLED = 'enabled', // TLS with server cert only
  MTLS = 'mtls', // TLS with both server and client certs
}

export interface Config {
  port: number;
  bind: string;
  ipc?: string;
  debugNamespace?: string[];
  // TLS settings
  keyPath?: string;
  crtPath?: string;
  tlsKey?: string;
  tlsCert?: string;
  tlsMode: TlsMode;
  // mTLS settings
  mtlsRequestCert?: boolean;
  mtlsRejectUnauthorized?: boolean;
  mtlsAllowedClientFingerprints?: string[];
  // Other settings
  logFile?: string;
  timeout: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
}
