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
  kmsServerCaCertPath?: string;
  kmsServerCaCert?: string;
  kmsClientTlsKeyPath?: string;
  kmsClientTlsCertPath?: string;
  kmsClientTlsKey?: string;
  kmsClientTlsCert?: string;
  kmsServerCertAllowSelfSigned?: boolean;

  // mTLS server settings
  serverTlsKeyPath?: string;
  serverTlsCertPath?: string;
  serverTlsKey?: string;
  serverTlsCert?: string;
  tlsMode: TlsMode;
  mtlsAllowedClientFingerprints?: string[];
  clientCertAllowSelfSigned?: boolean;
}

// Master Express mode specific configuration
export interface MasterExpressConfig extends BaseConfig {
  appMode: AppMode.MASTER_EXPRESS;
  // BitGo API settings
  env: EnvironmentName;
  customRootUri?: string;
  disableEnvCheck?: boolean;
  authVersion?: number;
  // AWM client settings
  advancedWalletManagerUrl: string;
  awmServerCaCertPath?: string;
  awmServerCaCert?: string;
  awmClientTlsKeyPath?: string;
  awmClientTlsCertPath?: string;
  awmClientTlsKey?: string;
  awmClientTlsCert?: string;
  awmServerCertAllowSelfSigned?: boolean;
  customBitcoinNetwork?: string;
  // mTLS server settings
  serverTlsKeyPath?: string;
  serverTlsCertPath?: string;
  serverTlsKey?: string;
  serverTlsCert?: string;
  tlsMode: TlsMode;
  mtlsAllowedClientFingerprints?: string[];
  clientCertAllowSelfSigned?: boolean;
  recoveryMode?: boolean;
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
