export enum TlsMode {
  DISABLED = 'disabled', // No TLS (plain HTTP)
  MTLS = 'mtls', // TLS with both server and client certs
}

export enum AppMode {
  ENCLAVED = 'enclaved',
  MASTER_EXPRESS = 'master-express',
}

export type EnvironmentName = 'prod' | 'test' | 'staging' | 'dev' | 'local';

// Enclaved mode specific configuration
export interface EnclavedConfig {
  appMode: AppMode.ENCLAVED;
  port: number;
  bind: string;
  ipc?: string;
  debugNamespace: string[];
  logFile: string;
  timeout: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
  kmsUrl: string;
  keyPath?: string;
  crtPath?: string;
  tlsKey?: string;
  tlsCert?: string;
  tlsMode: TlsMode;
  mtlsAllowedClientFingerprints?: string[];
  allowSelfSigned: boolean;
}

// Master Express mode specific configuration
export interface MasterExpressConfig {
  appMode: AppMode.MASTER_EXPRESS;
  port: number;
  bind: string;
  ipc?: string;
  debugNamespace: string[];
  logFile: string;
  timeout: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
  env: EnvironmentName;
  customRootUri?: string;
  disableEnvCheck: boolean;
  authVersion: number;
  enclavedExpressUrl: string;
  enclavedExpressCert: string;
  customBitcoinNetwork?: string;
  keyPath?: string;
  crtPath?: string;
  tlsKey?: string;
  tlsCert?: string;
  tlsMode: TlsMode;
  mtlsAllowedClientFingerprints?: string[];
  allowSelfSigned: boolean;
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
