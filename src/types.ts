/**
 * @prettier
 */
export enum TlsMode {
  DISABLED = 'disabled', // No TLS (plain HTTP)
  ENABLED = 'enabled', // TLS with server cert only
  MTLS = 'mtls', // TLS with both server and client certs
}

export enum AppMode {
  ENCLAVED = 'enclaved',
  MASTER_EXPRESS = 'master-express',
}

export type EnvironmentName = 'prod' | 'test' | 'staging' | 'dev' | 'local';

// Common base configuration shared by both modes
interface BaseConfig {
  appMode: AppMode;
  port: number;
  bind: string;
  ipc?: string;
  debugNamespace?: string[];
  logFile?: string;
  timeout: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
}

// Enclaved mode specific configuration
export interface EnclavedConfig extends BaseConfig {
  appMode: AppMode.ENCLAVED;
  // KMS settings
  kmsUrl: string;
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
}

// Master Express mode specific configuration
export interface MasterExpressConfig extends BaseConfig {
  appMode: AppMode.MASTER_EXPRESS;
  // BitGo API settings
  env: EnvironmentName;
  customRootUri?: string;
  enableSSL?: boolean;
  enableProxy?: boolean;
  disableEnvCheck?: boolean;
  authVersion?: number;
  enclavedExpressUrl: string;
  enclavedExpressSSLCert: string;
  customBitcoinNetwork?: string;
  // SSL settings (different from enclaved TLS)
  keyPath?: string;
  crtPath?: string;
  sslKey?: string;
  sslCert?: string;
}

// Union type for the configuration
export type Config = EnclavedConfig | MasterExpressConfig;

// Type guard for MasterExpressConfig
export function isMasterExpressConfig(config: Config): config is MasterExpressConfig {
  return config.appMode === AppMode.MASTER_EXPRESS;
}

// Type guard for EnclavedConfig
export function isEnclavedConfig(config: Config): config is EnclavedConfig {
  return config.appMode === AppMode.ENCLAVED;
}
