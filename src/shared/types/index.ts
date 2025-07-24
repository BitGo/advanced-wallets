export enum TlsMode {
  DISABLED = 'disabled', // No TLS (plain HTTP)
  MTLS = 'mtls', // TLS with both server and client certs
}

export enum AppMode {
  ENCLAVED = 'enclaved',
  MASTER_EXPRESS = 'master-express',
}

export type EnvironmentName = 'prod' | 'test' | 'staging' | 'dev' | 'local';

// Common base configuration shared by both modes
export interface BaseConfig {
  appMode: AppMode;
  port: number;
  bind: string;
  ipc?: string;
  timeout: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
  httpLoggerFile: string;
  recoveryMode?: boolean;
}

// Enclaved mode specific configuration
export interface EnclavedConfig extends BaseConfig {
  appMode: AppMode.ENCLAVED;
  // KMS settings
  kmsUrl: string;
  kmsTlsMode?: 'enabled' | 'disabled';
  kmsTlsCert?: string;
  kmsTlsCertPath?: string;
  // mTLS settings
  keyPath?: string;
  crtPath?: string;
  tlsKey?: string;
  tlsCert?: string;
  tlsMode: TlsMode;
  mtlsAllowedClientFingerprints?: string[];
  allowSelfSigned?: boolean;
}

// Master Express mode specific configuration
export interface MasterExpressConfig extends BaseConfig {
  appMode: AppMode.MASTER_EXPRESS;
  // BitGo API settings
  env: EnvironmentName;
  customRootUri?: string;
  disableEnvCheck?: boolean;
  authVersion?: number;
  enclavedExpressUrl: string;
  enclavedExpressCert: string;
  customBitcoinNetwork?: string;
  // mTLS settings
  keyPath?: string;
  crtPath?: string;
  tlsKey?: string;
  tlsCert?: string;
  tlsMode: TlsMode;
  mtlsAllowedClientFingerprints?: string[];
  allowSelfSigned?: boolean;
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
