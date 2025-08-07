import fs from 'fs';
import {
  Config,
  AdvancedWalletManagerConfig,
  MasterExpressConfig,
  TlsMode,
  AppMode,
  EnvironmentName,
} from './shared/types';
import logger from './logger';
import { validateTlsCertificates, validateMasterExpressConfig } from './shared/appUtils';

export {
  Config,
  AdvancedWalletManagerConfig,
  MasterExpressConfig,
  TlsMode,
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
  kmsUrl: '', // Will be overridden by environment variable
  tlsMode: TlsMode.MTLS,
  clientCertAllowSelfSigned: false,
};

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
  const kmsUrl = readEnvVar('KMS_URL');

  if (!kmsUrl) {
    logger.error('KMS_URL environment variable is required and cannot be empty');
    throw new Error('KMS_URL environment variable is required and cannot be empty');
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
    // KMS settings
    kmsUrl,
    kmsServerCaCertPath: readEnvVar('KMS_SERVER_CA_CERT_PATH'),
    kmsClientTlsKeyPath: readEnvVar('KMS_CLIENT_TLS_KEY_PATH'),
    kmsClientTlsCertPath: readEnvVar('KMS_CLIENT_TLS_CERT_PATH'),
    kmsServerCertAllowSelfSigned: readEnvVar('KMS_SERVER_CERT_ALLOW_SELF_SIGNED') === 'true',
    // mTLS server settings
    serverTlsKeyPath: readEnvVar('SERVER_TLS_KEY_PATH'),
    serverTlsCertPath: readEnvVar('SERVER_TLS_CERT_PATH'),
    serverTlsKey: readEnvVar('SERVER_TLS_KEY'),
    serverTlsCert: readEnvVar('SERVER_TLS_CERT'),
    tlsMode: determineTlsMode(),
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
    kmsUrl: get('kmsUrl'),
    kmsServerCaCertPath: get('kmsServerCaCertPath'),
    kmsServerCaCert: get('kmsServerCaCert'),
    kmsClientTlsKeyPath: get('kmsClientTlsKeyPath'),
    kmsClientTlsCertPath: get('kmsClientTlsCertPath'),
    kmsClientTlsKey: get('kmsClientTlsKey'),
    kmsClientTlsCert: get('kmsClientTlsCert'),
    kmsServerCertAllowSelfSigned: get('kmsServerCertAllowSelfSigned'),
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

function configureAdvancedWalletManagaerMode(): AdvancedWalletManagerConfig {
  const env = advancedWalletManagerEnvConfig();
  let config = mergeAkmConfigs(env);

  // Certificate Loading Section
  logger.info('=== Certificate Loading ===');

  // Only load certificates if TLS is enabled
  if (config.tlsMode !== TlsMode.DISABLED) {
    // Handle file loading for TLS certificates
    if (!config.serverTlsKey && config.serverTlsKeyPath) {
      try {
        config = { ...config, serverTlsKey: fs.readFileSync(config.serverTlsKeyPath, 'utf-8') };
        logger.info(`✓ TLS private key loaded from file: ${config.serverTlsKeyPath}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to read TLS key from serverTlsKeyPath: ${err.message}`);
      }
    } else if (config.serverTlsKey) {
      logger.info('✓ TLS private key loaded from environment variable');
    }

    if (!config.serverTlsCert && config.serverTlsCertPath) {
      try {
        config = {
          ...config,
          serverTlsCert: fs.readFileSync(config.serverTlsCertPath, 'utf-8'),
        };
        logger.info(`✓ TLS certificate loaded from file: ${config.serverTlsCertPath}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to read TLS certificate from serverTlsCertPath: ${err.message}`);
      }
    } else if (config.serverTlsCert) {
      logger.info('✓ TLS certificate loaded from environment variable');
    }

    if (!config.kmsServerCaCertPath) {
      throw new Error('KMS_SERVER_CA_CERT_PATH is required when TLS mode is MTLS');
    }
    if (config.kmsServerCaCertPath) {
      try {
        config.kmsServerCaCert = fs.readFileSync(config.kmsServerCaCertPath, 'utf-8');
        logger.info(`✓ KMS server CA certificate loaded from file: ${config.kmsServerCaCertPath}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to read KMS TLS certificate from kmsTlsCert: ${err.message}`);
      }
    }

    if (config.kmsClientTlsKeyPath) {
      try {
        config.kmsClientTlsKey = fs.readFileSync(config.kmsClientTlsKeyPath, 'utf-8');
        logger.info(`✓ KMS client key loaded from file: ${config.kmsClientTlsKeyPath}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to read KMS client key from kmsClientTlsKeyPath: ${err.message}`);
      }
    }

    if (config.kmsClientTlsCertPath) {
      try {
        config.kmsClientTlsCert = fs.readFileSync(config.kmsClientTlsCertPath, 'utf-8');
        logger.info(`✓ KMS client certificate loaded from file: ${config.kmsClientTlsCertPath}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to read KMS client cert from kmsClientTlsCertPath: ${err.message}`);
      }
    }

    // Fallback to server certs if client certs are not provided
    if (!config.kmsClientTlsKey) {
      config.kmsClientTlsKey = config.serverTlsKey;
    }
    if (!config.kmsClientTlsCert) {
      config.kmsClientTlsCert = config.serverTlsCert;
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
  const awmServerCaCertPath = readEnvVar('AWM_SERVER_CA_CERT_PATH');
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
    awmServerCaCertPath: awmServerCaCertPath,
    awmClientTlsKeyPath: readEnvVar('AWM_CLIENT_TLS_KEY_PATH'),
    awmClientTlsCertPath: readEnvVar('AWM_CLIENT_TLS_CERT_PATH'),
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
    awmServerCaCertPath: get('awmServerCaCertPath'),
    awmServerCaCert: get('awmServerCaCert'),
    awmClientTlsKeyPath: get('awmClientTlsKeyPath'),
    awmClientTlsCertPath: get('awmClientTlsCertPath'),
    awmClientTlsKey: get('awmClientTlsKey'),
    awmClientTlsCert: get('awmClientTlsCert'),
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
  config = { ...config, ...updates };

  // Certificate Loading Section
  logger.info('=== Certificate Loading ===');

  // Only load certificates if TLS is enabled
  if (config.tlsMode !== TlsMode.DISABLED) {
    // Handle file loading for TLS certificates
    if (!config.serverTlsKey && config.serverTlsKeyPath) {
      try {
        config = { ...config, serverTlsKey: fs.readFileSync(config.serverTlsKeyPath, 'utf-8') };
        logger.info(`✓ TLS private key loaded from file: ${config.serverTlsKeyPath}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to read TLS key from serverTlsKeyPath: ${err.message}`);
      }
    } else if (config.serverTlsKey) {
      logger.info('✓ TLS private key loaded from environment variable');
    }

    if (!config.serverTlsCert && config.serverTlsCertPath) {
      try {
        config = {
          ...config,
          serverTlsCert: fs.readFileSync(config.serverTlsCertPath, 'utf-8'),
        };
        logger.info(`✓ TLS certificate loaded from file: ${config.serverTlsCertPath}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        throw new Error(`Failed to read TLS certificate from serverTlsCertPath: ${err.message}`);
      }
    } else if (config.serverTlsCert) {
      logger.info('✓ TLS certificate loaded from environment variable');
    }

    // Validate that certificates are properly loaded when TLS is enabled
    validateTlsCertificates(config);
  }

  // Handle cert loading for Advanced Wallet Manager (always required for Master Express)
  if (config.awmServerCaCertPath) {
    try {
      if (fs.existsSync(config.awmServerCaCertPath)) {
        config = {
          ...config,
          awmServerCaCert: fs.readFileSync(config.awmServerCaCertPath, 'utf-8'),
        };
        logger.info(
          `✓ AWM server CA certificate loaded from file: ${config.awmServerCaCertPath?.substring(
            0,
            50,
          )}...`,
        );
      } else {
        throw new Error(`Certificate file not found: ${config.awmServerCaCertPath}`);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`Failed to read advanced wallet manager cert: ${err.message}`);
    }
  }

  if (config.awmClientTlsKeyPath) {
    try {
      config.awmClientTlsKey = fs.readFileSync(config.awmClientTlsKeyPath, 'utf-8');
      logger.info(`✓ AWM client key loaded from file: ${config.awmClientTlsKeyPath}`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`Failed to read AWM client key from awmClientTlsKeyPath: ${err.message}`);
    }
  }

  if (config.awmClientTlsCertPath) {
    try {
      config.awmClientTlsCert = fs.readFileSync(config.awmClientTlsCertPath, 'utf-8');
      logger.info(`✓ AWM client certificate loaded from file: ${config.awmClientTlsCertPath}`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`Failed to read AWM client cert from awmClientTlsCertPath: ${err.message}`);
    }
  }

  logger.info('==========================');

  // Fallback to server certs if client certs are not provided
  if (!config.awmClientTlsKey) {
    config.awmClientTlsKey = config.serverTlsKey;
  }
  if (!config.awmClientTlsCert) {
    config.awmClientTlsCert = config.serverTlsCert;
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
    return configureAdvancedWalletManagaerMode();
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
