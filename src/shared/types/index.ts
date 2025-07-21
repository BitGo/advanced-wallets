export enum TlsMode {
  DISABLED = 'disabled', // No TLS (plain HTTP)
  MTLS = 'mtls', // TLS with both server and client certs
}

export enum AppMode {
  SECURED = 'secured',
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

// Secured mode specific configuration
export interface SecuredExpressConfig extends BaseConfig {
  appMode: AppMode.SECURED;
  // KMS settings
  kmsUrl: string;
  // mTLS settings
  keyPath?: string;
  crtPath?: string;
  tlsKey?: string;
  tlsCert?: string;
  tlsMode: TlsMode;
  mtlsRequestCert: boolean;
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
  securedExpressUrl: string;
  securedExpressCert: string;
  customBitcoinNetwork?: string;
  // mTLS settings
  keyPath?: string;
  crtPath?: string;
  tlsKey?: string;
  tlsCert?: string;
  tlsMode: TlsMode;
  mtlsRequestCert: boolean;
  mtlsAllowedClientFingerprints?: string[];
  allowSelfSigned?: boolean;
}

// Union type for the configuration
export type Config = SecuredExpressConfig | MasterExpressConfig;

// Type guard for MasterExpressConfig
export function isMasterExpressConfig(config: Config): config is MasterExpressConfig {
  return config.appMode === AppMode.MASTER_EXPRESS;
}

// Type guard for SecuredExpressConfig
export function isSecuredExpressConfig(config: Config): config is SecuredExpressConfig {
  return config.appMode === AppMode.SECURED;
}
