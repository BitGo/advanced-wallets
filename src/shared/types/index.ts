export enum TlsMode {
  DISABLED = 'disabled', // No TLS (plain HTTP)
  MTLS = 'mtls', // TLS with both server and client certs
}

export enum AppMode {
  ADVANCED_WALLET_MANAGER = 'advanced-wallet-manager',
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

// Advanced wallet manager mode specific configuration
export interface AdvancedWalletManagerConfig extends BaseConfig {
  appMode: AppMode.ADVANCED_WALLET_MANAGER;
  // KMS settings
  kmsUrl: string;
  kmsTlsCertPath?: string;
  kmsTlsCert?: string;
  kmsAllowSelfSigned?: boolean;
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
  advancedWalletManagerUrl: string;
  advancedWalletManagerCert?: string;
  advancedWalletManagerAllowSelfSigned?: boolean;
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
export type Config = AdvancedWalletManagerConfig | MasterExpressConfig;

// Type guard for MasterExpressConfig
export function isMasterExpressConfig(config: Config): config is MasterExpressConfig {
  return config.appMode === AppMode.MASTER_EXPRESS;
}

// Type guard for AdvancedWalletManagerConfig
export function isAdvancedWalletManagerConfig(
  config: Config,
): config is AdvancedWalletManagerConfig {
  return config.appMode === AppMode.ADVANCED_WALLET_MANAGER;
}
