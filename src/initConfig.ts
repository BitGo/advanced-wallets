import fs from 'fs';
import {
  Config,
  AdvancedWalletManagerConfig,
  MasterExpressConfig,
  TlsMode,
  SigningMode,
  AppMode,
  EnvironmentName,
} from './shared/types';
import logger from './shared/logger';
import { validateTlsCertificates, validateMasterExpressConfig } from './shared/appUtils';

export {
  Config,
  AdvancedWalletManagerConfig,
  MasterExpressConfig,
  TlsMode,
  SigningMode,
  AppMode,
  EnvironmentName,
};

function isNilOrNaN(val: unknown): val is null | undefined | number {
  return val == null || (typeof val === 'number' && isNaN(val));
}

function readEnvVar(name: string): string | undefined {
  if (process.env[name] !== undefined && process.env[name] !== '') {
    return process.env[name];
  }
}

function readCertFile(filePath: string, label: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    logger.info(`✓ ${label} loaded from file: ${filePath}`);
    return content;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`Failed to read ${label} from ${filePath}: ${err.message}`);
  }
}

/**
 * Loads a certificate/key value from either an environment variable or a file path.
 * If the value is already set (from env), it logs and returns it.
 * If a path is provided, it reads the file.
 * Returns undefined if neither is set.
 */
function loadCert(
  value: string | undefined,
  path: string | undefined,
  label: string,
): string | undefined {
  if (value) {
    logger.info(`✓ ${label} loaded from environment variable`);
    return value;
  }
  if (path) {
    return readCertFile(path, label);
  }
  return undefined;
}

function determineAppMode(): AppMode {
  const mode = readEnvVar('APP_MODE') || readEnvVar('BITGO_APP_MODE');
  if (!mode) {
    throw new Error(
      'APP_MODE environment variable is required. Set APP_MODE to either "advanced-wallet-manager" or "master-express"',
    );
  }
  if (mode === 'master-express') {
    return AppMode.MASTER_EXPRESS;
  }
  if (mode === 'advanced-wallet-manager') {
    return AppMode.ADVANCED_WALLET_MANAGER;
  }
  throw new Error(
    `Invalid APP_MODE: ${mode}. Must be either "advanced-wallet-manager" or "master-express"`,
  );
}

export { determineAppMode };

// ============================================================================
// ADVANCED WALLET MANAGER MODE CONFIGURATION
// ============================================================================

const advancedWalletManagerConfig: AdvancedWalletManagerConfig = {
  appMode: AppMode.ADVANCED_WALLET_MANAGER,
  port: 3080,
  bind: 'localhost',
  timeout: 305 * 1000,
  httpLoggerFile: 'logs/http-access.log',
  keyProviderUrl: '', // Will be overridden by environment variable
  tlsMode: TlsMode.MTLS,
  signingMode: SigningMode.LOCAL,
  clientCertAllowSelfSigned: false,
};

const SIGNING_MODE_MAP: Record<string, SigningMode> = {
  local: SigningMode.LOCAL,
  external: SigningMode.EXTERNAL,
};

function determineSigningMode(): SigningMode {
  const raw = readEnvVar('SIGNING_MODE')?.toLowerCase();
  if (!raw) return SigningMode.LOCAL;
  const mode = SIGNING_MODE_MAP[raw];
  if (!mode) {
    throw new Error(
      `Invalid SIGNING_MODE: ${raw}. Must be one of: ${Object.keys(SIGNING_MODE_MAP).join(', ')}`,
    );
  }
  return mode;
}

function determineTlsMode(): TlsMode {
  const tlsMode = readEnvVar('TLS_MODE')?.toLowerCase();

  if (!tlsMode) {
    logger.warn('TLS_MODE not set, defaulting to MTLS. Set TLS_MODE=disabled to disable TLS.');
    return TlsMode.MTLS;
  }

  if (tlsMode === 'disabled') {
    return TlsMode.DISABLED;
  }

  if (tlsMode === 'mtls') {
    return TlsMode.MTLS;
  }

  throw new Error(`Invalid TLS_MODE: ${tlsMode}. Must be either "disabled" or "mtls"`);
}

function advancedWalletManagerEnvConfig(): Partial<AdvancedWalletManagerConfig> {
  const keyProviderUrl = readEnvVar('KEY_PROVIDER_URL');

  if (!keyProviderUrl) {
    logger.error('KEY_PROVIDER_URL environment variable is required and cannot be empty');
    throw new Error('KEY_PROVIDER_URL environment variable is required and cannot be empty');
  }

  return {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    port: Number(readEnvVar('ADVANCED_WALLET_MANAGER_PORT')),
    bind: readEnvVar('BIND'),
    ipc: readEnvVar('IPC'),
    httpLoggerFile: readEnvVar('HTTP_LOGFILE') || 'logs/http-access.log',
    timeout: Number(readEnvVar('TIMEOUT')),
    keepAliveTimeout: Number(readEnvVar('KEEP_ALIVE_TIMEOUT')),
    headersTimeout: Number(readEnvVar('HEADERS_TIMEOUT')),
    // key provider settings
    keyProviderUrl,
    keyProviderServerCaCertPath: readEnvVar('KEY_PROVIDER_SERVER_CA_CERT_PATH'),
    keyProviderClientTlsKeyPath: readEnvVar('KEY_PROVIDER_CLIENT_TLS_KEY_PATH'),
    keyProviderClientTlsCertPath: readEnvVar('KEY_PROVIDER_CLIENT_TLS_CERT_PATH'),
    keyProviderClientTlsKey: readEnvVar('KEY_PROVIDER_CLIENT_TLS_KEY'),
    keyProviderClientTlsCert: readEnvVar('KEY_PROVIDER_CLIENT_TLS_CERT'),
    keyProviderServerCertAllowSelfSigned:
      readEnvVar('KEY_PROVIDER_SERVER_CERT_ALLOW_SELF_SIGNED') === 'true',
    // mTLS server settings
    serverTlsKeyPath: readEnvVar('SERVER_TLS_KEY_PATH'),
    serverTlsCertPath: readEnvVar('SERVER_TLS_CERT_PATH'),
    serverTlsKey: readEnvVar('SERVER_TLS_KEY'),
    serverTlsCert: readEnvVar('SERVER_TLS_CERT'),
    tlsMode: determineTlsMode(),
    signingMode: determineSigningMode(),
    mtlsAllowedClientFingerprints: readEnvVar('MTLS_ALLOWED_CLIENT_FINGERPRINTS')?.split(','),
    clientCertAllowSelfSigned: readEnvVar('CLIENT_CERT_ALLOW_SELF_SIGNED') === 'true',
    recoveryMode: readEnvVar('RECOVERY_MODE') === 'true',
  };
}

function mergeAkmConfigs(
  ...configs: Partial<AdvancedWalletManagerConfig>[]
): AdvancedWalletManagerConfig {
  function get<T extends keyof AdvancedWalletManagerConfig>(k: T): AdvancedWalletManagerConfig[T] {
    return configs.reduce(
      (entry: AdvancedWalletManagerConfig[T], config) =>
        !isNilOrNaN(config[k]) ? (config[k] as AdvancedWalletManagerConfig[T]) : entry,
      advancedWalletManagerConfig[k],
    );
  }

  return {
    appMode: AppMode.ADVANCED_WALLET_MANAGER,
    port: get('port'),
    bind: get('bind'),
    ipc: get('ipc'),
    httpLoggerFile: get('httpLoggerFile'),
    timeout: get('timeout'),
    keepAliveTimeout: get('keepAliveTimeout'),
    headersTimeout: get('headersTimeout'),
    keyProviderUrl: get('keyProviderUrl'),
    keyProviderServerCaCertPath: get('keyProviderServerCaCertPath'),
    keyProviderServerCaCert: get('keyProviderServerCaCert'),
    keyProviderClientTlsKeyPath: get('keyProviderClientTlsKeyPath'),
    keyProviderClientTlsCertPath: get('keyProviderClientTlsCertPath'),
    keyProviderClientTlsKey: get('keyProviderClientTlsKey'),
    keyProviderClientTlsCert: get('keyProviderClientTlsCert'),
    keyProviderServerCertAllowSelfSigned: get('keyProviderServerCertAllowSelfSigned'),
    serverTlsKeyPath: get('serverTlsKeyPath'),
    serverTlsCertPath: get('serverTlsCertPath'),
    serverTlsKey: get('serverTlsKey'),
    serverTlsCert: get('serverTlsCert'),
    tlsMode: get('tlsMode'),
    signingMode: get('signingMode'),
    mtlsAllowedClientFingerprints: get('mtlsAllowedClientFingerprints'),
    clientCertAllowSelfSigned: get('clientCertAllowSelfSigned'),
    recoveryMode: get('recoveryMode'),
  };
}

function configureAdvancedWalletManagerMode(): AdvancedWalletManagerConfig {
  const env = advancedWalletManagerEnvConfig();
  let config = mergeAkmConfigs(env);

  // Certificate Loading Section
  logger.info('=== Certificate Loading ===');

  // Only load certificates if TLS is enabled
  if (config.tlsMode !== TlsMode.DISABLED) {
    if (!config.keyProviderServerCaCertPath) {
      throw new Error('KEY_PROVIDER_SERVER_CA_CERT_PATH is required when TLS mode is MTLS');
    }

    config = {
      ...config,
      serverTlsKey: loadCert(config.serverTlsKey, config.serverTlsKeyPath, 'TLS private key'),
      serverTlsCert: loadCert(config.serverTlsCert, config.serverTlsCertPath, 'TLS certificate'),
      keyProviderServerCaCert: readCertFile(
        config.keyProviderServerCaCertPath,
        'Key provider server CA certificate',
      ),
      keyProviderClientTlsKey: loadCert(
        config.keyProviderClientTlsKey,
        config.keyProviderClientTlsKeyPath,
        'Key provider client key',
      ),
      keyProviderClientTlsCert: loadCert(
        config.keyProviderClientTlsCert,
        config.keyProviderClientTlsCertPath,
        'Key provider client certificate',
      ),
    };

    // Validate that client certificates are provided for outbound mTLS connections
    if (config.tlsMode === TlsMode.MTLS) {
      if (!config.keyProviderClientTlsKey || !config.keyProviderClientTlsCert) {
        throw new Error(
          'KEY_PROVIDER_CLIENT_TLS_KEY_PATH and KEY_PROVIDER_CLIENT_TLS_CERT_PATH (or KEY_PROVIDER_CLIENT_TLS_KEY and KEY_PROVIDER_CLIENT_TLS_CERT) are required for outbound mTLS connections to key provider. Client certificates cannot reuse server certificates for security reasons.',
        );
      }
    }

    // Validate that certificates are properly loaded when TLS is enabled
    validateTlsCertificates(config);
  }

  logger.info('==========================');

  return config;
}

// ============================================================================
// MASTER EXPRESS MODE CONFIGURATION
// ============================================================================

const defaultMasterExpressConfig: MasterExpressConfig = {
  appMode: AppMode.MASTER_EXPRESS,
  port: 3081,
  bind: 'localhost',
  timeout: 305 * 1000,
  httpLoggerFile: 'logs/http-access.log',
  env: 'test',
  disableEnvCheck: true,
  authVersion: 2,
  advancedWalletManagerUrl: '', // Will be overridden by environment variable
  awmServerCaCertPath: '', // Will be overridden by environment variable
  tlsMode: TlsMode.MTLS,
  clientCertAllowSelfSigned: false,
};

function determineProtocol(url: string, tlsMode: TlsMode, isBitGo = false): string {
  const regex = new RegExp(/(^\w+:|^)\/\//);
  const protocol = isBitGo ? 'https' : tlsMode === TlsMode.DISABLED ? 'http' : 'https';
  if (regex.test(url)) {
    return url.replace(/(^\w+:|^)\/\//, `${protocol}://`);
  }
  return `${protocol}://${url}`;
}

function masterExpressEnvConfig(): Partial<MasterExpressConfig> {
  const advancedWalletManagerUrl = readEnvVar('ADVANCED_WALLET_MANAGER_URL');
  const advancedWalletManagerBackupUrl = readEnvVar('ADVANCED_WALLET_MANAGER_BACKUP_URL');
  const awmServerCaCertPath = readEnvVar('AWM_SERVER_CA_CERT_PATH');
  const awmBackupServerCaCertPath = readEnvVar('AWM_BACKUP_SERVER_CA_CERT_PATH');
  const awmServerCertAllowSelfSigned = readEnvVar('AWM_SERVER_CERT_ALLOW_SELF_SIGNED') === 'true';
  const tlsMode = determineTlsMode();

  if (!advancedWalletManagerUrl) {
    throw new Error(
      'ADVANCED_WALLET_MANAGER_URL environment variable is required and cannot be empty',
    );
  }

  if (tlsMode === TlsMode.MTLS && !awmServerCaCertPath) {
    throw new Error('AWM_SERVER_CA_CERT_PATH environment variable is required for MTLS mode.');
  }

  if (advancedWalletManagerBackupUrl && tlsMode === TlsMode.MTLS && !awmBackupServerCaCertPath) {
    throw new Error(
      'AWM_BACKUP_SERVER_CA_CERT_PATH environment variable is required for MTLS mode when provisioning a backup AWM URL.',
    );
  }

  // Debug mTLS environment variables
  const clientCertAllowSelfSignedRaw = readEnvVar('CLIENT_CERT_ALLOW_SELF_SIGNED');
  const clientCertAllowSelfSigned = clientCertAllowSelfSignedRaw === 'true';

  return {
    appMode: AppMode.MASTER_EXPRESS,
    port: Number(readEnvVar('MASTER_EXPRESS_PORT')),
    bind: readEnvVar('BIND'),
    ipc: readEnvVar('IPC'),
    httpLoggerFile: readEnvVar('HTTP_LOGFILE') || 'logs/http-access.log',
    timeout: Number(readEnvVar('TIMEOUT')),
    keepAliveTimeout: Number(readEnvVar('KEEP_ALIVE_TIMEOUT')),
    headersTimeout: Number(readEnvVar('HEADERS_TIMEOUT')),
    // BitGo API settings
    env: readEnvVar('BITGO_ENV') as EnvironmentName,
    customRootUri: readEnvVar('BITGO_CUSTOM_ROOT_URI'),
    disableEnvCheck: readEnvVar('BITGO_DISABLE_ENV_CHECK') === 'true',
    authVersion: Number(readEnvVar('BITGO_AUTH_VERSION')),
    advancedWalletManagerUrl: advancedWalletManagerUrl,
    advancedWalletManagerBackupUrl: advancedWalletManagerBackupUrl,
    awmServerCaCertPath: awmServerCaCertPath,
    awmClientTlsKeyPath: readEnvVar('AWM_CLIENT_TLS_KEY_PATH'),
    awmClientTlsCertPath: readEnvVar('AWM_CLIENT_TLS_CERT_PATH'),
    awmClientTlsKey: readEnvVar('AWM_CLIENT_TLS_KEY'),
    awmClientTlsCert: readEnvVar('AWM_CLIENT_TLS_CERT'),
    awmBackupServerCaCertPath: awmBackupServerCaCertPath,
    awmBackupClientTlsKeyPath: readEnvVar('AWM_BACKUP_CLIENT_TLS_KEY_PATH'),
    awmBackupClientTlsCertPath: readEnvVar('AWM_BACKUP_CLIENT_TLS_CERT_PATH'),
    awmBackupClientTlsKey: readEnvVar('AWM_BACKUP_CLIENT_TLS_KEY'),
    awmBackupClientTlsCert: readEnvVar('AWM_BACKUP_CLIENT_TLS_CERT'),
    awmServerCertAllowSelfSigned,
    customBitcoinNetwork: readEnvVar('BITGO_CUSTOM_BITCOIN_NETWORK'),
    // mTLS server settings
    serverTlsKeyPath: readEnvVar('SERVER_TLS_KEY_PATH'),
    serverTlsCertPath: readEnvVar('SERVER_TLS_CERT_PATH'),
    serverTlsKey: readEnvVar('SERVER_TLS_KEY'),
    serverTlsCert: readEnvVar('SERVER_TLS_CERT'),
    tlsMode,
    mtlsAllowedClientFingerprints: readEnvVar('MTLS_ALLOWED_CLIENT_FINGERPRINTS')?.split(','),
    clientCertAllowSelfSigned,
    recoveryMode: readEnvVar('RECOVERY_MODE') === 'true',
  };
}

function mergeMasterExpressConfigs(
  ...configs: Partial<MasterExpressConfig>[]
): MasterExpressConfig {
  function get<T extends keyof MasterExpressConfig>(k: T): MasterExpressConfig[T] {
    return configs.reduce(
      (entry: MasterExpressConfig[T], config) =>
        !isNilOrNaN(config[k]) ? (config[k] as MasterExpressConfig[T]) : entry,
      defaultMasterExpressConfig[k],
    );
  }

  return {
    appMode: AppMode.MASTER_EXPRESS,
    port: get('port'),
    bind: get('bind'),
    ipc: get('ipc'),
    httpLoggerFile: get('httpLoggerFile'),
    timeout: get('timeout'),
    keepAliveTimeout: get('keepAliveTimeout'),
    headersTimeout: get('headersTimeout'),
    env: get('env'),
    customRootUri: get('customRootUri'),
    disableEnvCheck: get('disableEnvCheck'),
    authVersion: get('authVersion'),
    advancedWalletManagerUrl: get('advancedWalletManagerUrl'),
    advancedWalletManagerBackupUrl: get('advancedWalletManagerBackupUrl'),
    awmServerCaCertPath: get('awmServerCaCertPath'),
    awmServerCaCert: get('awmServerCaCert'),
    awmClientTlsKeyPath: get('awmClientTlsKeyPath'),
    awmClientTlsCertPath: get('awmClientTlsCertPath'),
    awmClientTlsKey: get('awmClientTlsKey'),
    awmClientTlsCert: get('awmClientTlsCert'),
    // Backup AWM configs
    awmBackupServerCaCertPath: get('awmBackupServerCaCertPath'),
    awmBackupServerCaCert: get('awmBackupServerCaCert'),
    awmBackupClientTlsKeyPath: get('awmBackupClientTlsKeyPath'),
    awmBackupClientTlsCertPath: get('awmBackupClientTlsCertPath'),
    awmBackupClientTlsKey: get('awmBackupClientTlsKey'),
    awmBackupClientTlsCert: get('awmBackupClientTlsCert'),
    awmServerCertAllowSelfSigned: get('awmServerCertAllowSelfSigned'),
    customBitcoinNetwork: get('customBitcoinNetwork'),
    serverTlsKeyPath: get('serverTlsKeyPath'),
    serverTlsCertPath: get('serverTlsCertPath'),
    serverTlsKey: get('serverTlsKey'),
    serverTlsCert: get('serverTlsCert'),
    tlsMode: get('tlsMode'),
    mtlsAllowedClientFingerprints: get('mtlsAllowedClientFingerprints'),
    clientCertAllowSelfSigned: get('clientCertAllowSelfSigned'),
    recoveryMode: get('recoveryMode'),
  };
}

export function configureMasterExpressMode(): MasterExpressConfig {
  const env = masterExpressEnvConfig();
  let config = mergeMasterExpressConfigs(env);

  // Post-process URLs to ensure they use the correct protocol based on TLS mode
  const updates: Partial<MasterExpressConfig> = {};
  if (config.customRootUri) {
    updates.customRootUri = determineProtocol(config.customRootUri, config.tlsMode, true);
  }
  if (config.advancedWalletManagerUrl) {
    updates.advancedWalletManagerUrl = determineProtocol(
      config.advancedWalletManagerUrl,
      config.tlsMode,
      false,
    );
  }
  if (config.advancedWalletManagerBackupUrl) {
    updates.advancedWalletManagerBackupUrl = determineProtocol(
      config.advancedWalletManagerBackupUrl,
      config.tlsMode,
      false,
    );
  }
  config = { ...config, ...updates };

  // Certificate Loading Section
  logger.info('=== Certificate Loading ===');

  // Only load certificates if TLS is enabled
  if (config.tlsMode !== TlsMode.DISABLED) {
    config = {
      ...config,
      serverTlsKey: loadCert(config.serverTlsKey, config.serverTlsKeyPath, 'TLS private key'),
      serverTlsCert: loadCert(config.serverTlsCert, config.serverTlsCertPath, 'TLS certificate'),
    };

    // Validate that certificates are properly loaded when TLS is enabled
    validateTlsCertificates(config);
  }

  // Handle cert loading for Advanced Wallet Manager (always required for Master Express)
  config = {
    ...config,
    awmServerCaCert: loadCert(
      config.awmServerCaCert,
      config.awmServerCaCertPath,
      'AWM server CA certificate',
    ),
    awmClientTlsKey: loadCert(config.awmClientTlsKey, config.awmClientTlsKeyPath, 'AWM client key'),
    awmClientTlsCert: loadCert(
      config.awmClientTlsCert,
      config.awmClientTlsCertPath,
      'AWM client certificate',
    ),
  };

  // Handle cert loading for backup AWM (only when backup URL is configured)
  if (config.advancedWalletManagerBackupUrl) {
    config = {
      ...config,
      awmBackupServerCaCert: loadCert(
        config.awmBackupServerCaCert,
        config.awmBackupServerCaCertPath,
        'AWM backup server CA certificate',
      ),
      awmBackupClientTlsKey: loadCert(
        config.awmBackupClientTlsKey,
        config.awmBackupClientTlsKeyPath,
        'AWM backup client key',
      ),
      awmBackupClientTlsCert: loadCert(
        config.awmBackupClientTlsCert,
        config.awmBackupClientTlsCertPath,
        'AWM backup client certificate',
      ),
    };
  }

  logger.info('==========================');

  // Validate that client certificates are provided for outbound mTLS connections
  if (config.tlsMode === TlsMode.MTLS) {
    if (!config.awmClientTlsKey || !config.awmClientTlsCert) {
      throw new Error(
        'AWM_CLIENT_TLS_KEY_PATH and AWM_CLIENT_TLS_CERT_PATH (or AWM_CLIENT_TLS_KEY and AWM_CLIENT_TLS_CERT) are required for outbound mTLS connections to Advanced Wallet Manager. Client certificates cannot reuse server certificates for security reasons.',
      );
    }

    // Validate that dedicated backup certificates are provided when a backup AWM URL is configured
    if (config.advancedWalletManagerBackupUrl) {
      if (!config.awmBackupServerCaCert) {
        throw new Error(
          'AWM_BACKUP_SERVER_CA_CERT_PATH is required for mTLS communication with the backup Advanced Wallet Manager.',
        );
      }
      if (!config.awmBackupClientTlsKey || !config.awmBackupClientTlsCert) {
        throw new Error(
          'AWM_BACKUP_CLIENT_TLS_KEY_PATH and AWM_BACKUP_CLIENT_TLS_CERT_PATH (or AWM_BACKUP_CLIENT_TLS_KEY and AWM_BACKUP_CLIENT_TLS_CERT) are required for mTLS communication with the backup Advanced Wallet Manager.',
        );
      }
    }
  }

  // Validate Master Express configuration
  validateMasterExpressConfig(config);

  return config;
}

// ============================================================================
// MAIN CONFIG FUNCTION
// ============================================================================

export function initConfig(): Config {
  const appMode = determineAppMode();

  if (appMode === AppMode.ADVANCED_WALLET_MANAGER) {
    return configureAdvancedWalletManagerMode();
  } else if (appMode === AppMode.MASTER_EXPRESS) {
    return configureMasterExpressMode();
  } else {
    throw new Error(`Unknown app mode: ${appMode}`);
  }
}

// Type guards for working with the union type
export function isAdvancedWalletManagerConfig(
  config: Config,
): config is AdvancedWalletManagerConfig {
  return config.appMode === AppMode.ADVANCED_WALLET_MANAGER;
}

export function isMasterExpressConfig(config: Config): config is MasterExpressConfig {
  return config.appMode === AppMode.MASTER_EXPRESS;
}
