import fs from 'fs';
import {
  Config,
  EnclavedConfig,
  MasterExpressConfig,
  TlsMode,
  AppMode,
  EnvironmentName,
} from './types';

export { Config, EnclavedConfig, MasterExpressConfig, TlsMode, AppMode, EnvironmentName };

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
      'APP_MODE environment variable is required. Set APP_MODE to either "enclaved" or "master-express"',
    );
  }
  if (mode === 'master-express') {
    return AppMode.MASTER_EXPRESS;
  }
  if (mode === 'enclaved') {
    return AppMode.ENCLAVED;
  }
  throw new Error(`Invalid APP_MODE: ${mode}. Must be either "enclaved" or "master-express"`);
}

// ============================================================================
// ENCLAVED MODE CONFIGURATION
// ============================================================================

const defaultEnclavedConfig: EnclavedConfig = {
  appMode: AppMode.ENCLAVED,
  port: 3080,
  bind: 'localhost',
  timeout: 305 * 1000,
  logFile: '',
  kmsUrl: '', // Will be overridden by environment variable
  tlsMode: TlsMode.ENABLED,
  mtlsRequestCert: false,
  mtlsRejectUnauthorized: false,
};

function determineTlsMode(): TlsMode {
  const disableTls = readEnvVar('MASTER_BITGO_EXPRESS_DISABLE_TLS') === 'true';
  const mtlsEnabled = readEnvVar('MTLS_ENABLED') === 'true';

  if (disableTls && mtlsEnabled) {
    throw new Error('Cannot have both TLS disabled and mTLS enabled');
  }

  if (disableTls) return TlsMode.DISABLED;
  if (mtlsEnabled) return TlsMode.MTLS;
  return TlsMode.ENABLED;
}

function enclavedEnvConfig(): Partial<EnclavedConfig> {
  const kmsUrl = readEnvVar('KMS_URL');

  if (!kmsUrl) {
    throw new Error('KMS_URL environment variable is required and cannot be empty');
  }

  return {
    appMode: AppMode.ENCLAVED,
    port: Number(readEnvVar('MASTER_BITGO_EXPRESS_PORT')),
    bind: readEnvVar('MASTER_BITGO_EXPRESS_BIND'),
    ipc: readEnvVar('MASTER_BITGO_EXPRESS_IPC'),
    debugNamespace: (readEnvVar('MASTER_BITGO_EXPRESS_DEBUG_NAMESPACE') || '')
      .split(',')
      .filter(Boolean),
    logFile: readEnvVar('MASTER_BITGO_EXPRESS_LOGFILE'),
    timeout: Number(readEnvVar('MASTER_BITGO_EXPRESS_TIMEOUT')),
    keepAliveTimeout: Number(readEnvVar('MASTER_BITGO_EXPRESS_KEEP_ALIVE_TIMEOUT')),
    headersTimeout: Number(readEnvVar('MASTER_BITGO_EXPRESS_HEADERS_TIMEOUT')),
    // KMS settings
    kmsUrl,
    // TLS settings
    keyPath: readEnvVar('MASTER_BITGO_EXPRESS_KEYPATH'),
    crtPath: readEnvVar('MASTER_BITGO_EXPRESS_CRTPATH'),
    tlsKey: readEnvVar('MASTER_BITGO_EXPRESS_TLS_KEY'),
    tlsCert: readEnvVar('MASTER_BITGO_EXPRESS_TLS_CERT'),
    tlsMode: determineTlsMode(),
    // mTLS settings
    mtlsRequestCert: readEnvVar('MTLS_REQUEST_CERT') === 'true',
    mtlsRejectUnauthorized: readEnvVar('MTLS_REJECT_UNAUTHORIZED') === 'true',
    mtlsAllowedClientFingerprints: readEnvVar('MTLS_ALLOWED_CLIENT_FINGERPRINTS')?.split(','),
  };
}

function mergeEnclavedConfigs(...configs: Partial<EnclavedConfig>[]): EnclavedConfig {
  function get<T extends keyof EnclavedConfig>(k: T): EnclavedConfig[T] {
    return configs.reduce(
      (entry: EnclavedConfig[T], config) =>
        !isNilOrNaN(config[k]) ? (config[k] as EnclavedConfig[T]) : entry,
      defaultEnclavedConfig[k],
    );
  }

  return {
    appMode: AppMode.ENCLAVED,
    port: get('port'),
    bind: get('bind'),
    ipc: get('ipc'),
    debugNamespace: get('debugNamespace'),
    logFile: get('logFile'),
    timeout: get('timeout'),
    keepAliveTimeout: get('keepAliveTimeout'),
    headersTimeout: get('headersTimeout'),
    kmsUrl: get('kmsUrl'),
    keyPath: get('keyPath'),
    crtPath: get('crtPath'),
    tlsKey: get('tlsKey'),
    tlsCert: get('tlsCert'),
    tlsMode: get('tlsMode'),
    mtlsRequestCert: get('mtlsRequestCert'),
    mtlsRejectUnauthorized: get('mtlsRejectUnauthorized'),
    mtlsAllowedClientFingerprints: get('mtlsAllowedClientFingerprints'),
  };
}

function configureEnclavedMode(): EnclavedConfig {
  const env = enclavedEnvConfig();
  let config = mergeEnclavedConfigs(env);

  // Handle file loading for TLS certificates
  if (!config.tlsKey && config.keyPath) {
    try {
      config = { ...config, tlsKey: fs.readFileSync(config.keyPath, 'utf-8') };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`Failed to read TLS key from keyPath: ${err.message}`);
    }
  }
  if (!config.tlsCert && config.crtPath) {
    try {
      config = { ...config, tlsCert: fs.readFileSync(config.crtPath, 'utf-8') };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`Failed to read TLS certificate from crtPath: ${err.message}`);
    }
  }

  return config;
}

// ============================================================================
// MASTER EXPRESS MODE CONFIGURATION
// ============================================================================

const defaultMasterExpressConfig: MasterExpressConfig = {
  appMode: AppMode.MASTER_EXPRESS,
  port: 3080,
  bind: 'localhost',
  timeout: 305 * 1000,
  logFile: '',
  env: 'test',
  enableSSL: true,
  enableProxy: true,
  disableEnvCheck: true,
  authVersion: 2,
  enclavedExpressUrl: '', // Will be overridden by environment variable
  enclavedExpressSSLCert: '', // Will be overridden by environment variable
};

function forceSecureUrl(url: string): string {
  const regex = new RegExp(/(^\w+:|^)\/\//);
  if (regex.test(url)) {
    return url.replace(/(^\w+:|^)\/\//, 'https://');
  }
  return `https://${url}`;
}

function masterExpressEnvConfig(): Partial<MasterExpressConfig> {
  const enclavedExpressUrl = readEnvVar('ENCLAVED_EXPRESS_URL');
  const enclavedExpressSSLCert = readEnvVar('ENCLAVED_EXPRESS_SSL_CERT');

  if (!enclavedExpressUrl) {
    throw new Error('ENCLAVED_EXPRESS_URL environment variable is required and cannot be empty');
  }

  if (!enclavedExpressSSLCert) {
    throw new Error(
      'ENCLAVED_EXPRESS_SSL_CERT environment variable is required and cannot be empty',
    );
  }

  return {
    appMode: AppMode.MASTER_EXPRESS,
    port: Number(readEnvVar('BITGO_PORT')),
    bind: readEnvVar('BITGO_BIND'),
    ipc: readEnvVar('BITGO_IPC'),
    debugNamespace: (readEnvVar('BITGO_DEBUG_NAMESPACE') || '').split(',').filter(Boolean),
    logFile: readEnvVar('BITGO_LOGFILE'),
    timeout: Number(readEnvVar('BITGO_TIMEOUT')),
    keepAliveTimeout: Number(readEnvVar('BITGO_KEEP_ALIVE_TIMEOUT')),
    headersTimeout: Number(readEnvVar('BITGO_HEADERS_TIMEOUT')),
    // BitGo API settings
    env: readEnvVar('BITGO_ENV') as EnvironmentName,
    customRootUri: readEnvVar('BITGO_CUSTOM_ROOT_URI'),
    enableSSL: readEnvVar('BITGO_ENABLE_SSL') !== 'false', // Default to true unless explicitly set to false
    enableProxy: readEnvVar('BITGO_ENABLE_PROXY') !== 'false', // Default to true unless explicitly set to false
    disableEnvCheck: readEnvVar('BITGO_DISABLE_ENV_CHECK') === 'true',
    authVersion: Number(readEnvVar('BITGO_AUTH_VERSION')),
    enclavedExpressUrl,
    enclavedExpressSSLCert,
    customBitcoinNetwork: readEnvVar('BITGO_CUSTOM_BITCOIN_NETWORK'),
    // SSL settings
    keyPath: readEnvVar('BITGO_KEYPATH'),
    crtPath: readEnvVar('BITGO_CRTPATH'),
    sslKey: readEnvVar('BITGO_SSL_KEY'),
    sslCert: readEnvVar('BITGO_SSL_CERT'),
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
    debugNamespace: get('debugNamespace'),
    logFile: get('logFile'),
    timeout: get('timeout'),
    keepAliveTimeout: get('keepAliveTimeout'),
    headersTimeout: get('headersTimeout'),
    env: get('env'),
    customRootUri: get('customRootUri'),
    enableSSL: get('enableSSL'),
    enableProxy: get('enableProxy'),
    disableEnvCheck: get('disableEnvCheck'),
    authVersion: get('authVersion'),
    enclavedExpressUrl: get('enclavedExpressUrl'),
    enclavedExpressSSLCert: get('enclavedExpressSSLCert'),
    customBitcoinNetwork: get('customBitcoinNetwork'),
    keyPath: get('keyPath'),
    crtPath: get('crtPath'),
    sslKey: get('sslKey'),
    sslCert: get('sslCert'),
  };
}

function configureMasterExpressMode(): MasterExpressConfig {
  const env = masterExpressEnvConfig();
  let config = mergeMasterExpressConfigs(env);

  // Post-process URLs if SSL is enabled
  if (config.enableSSL) {
    const updates: Partial<MasterExpressConfig> = {};
    if (config.customRootUri) {
      updates.customRootUri = forceSecureUrl(config.customRootUri);
    }
    if (config.enclavedExpressUrl) {
      updates.enclavedExpressUrl = forceSecureUrl(config.enclavedExpressUrl);
    }
    config = { ...config, ...updates };
  }

  // Handle SSL cert loading
  if (config.enclavedExpressSSLCert) {
    try {
      if (fs.existsSync(config.enclavedExpressSSLCert)) {
        config = {
          ...config,
          enclavedExpressSSLCert: fs.readFileSync(config.enclavedExpressSSLCert, 'utf-8'),
        };
      } else {
        throw new Error(`Certificate file not found: ${config.enclavedExpressSSLCert}`);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`Failed to read enclaved express SSL cert: ${err.message}`);
    }
  }

  return config;
}

// ============================================================================
// MAIN CONFIG FUNCTION
// ============================================================================

export function config(): Config {
  const appMode = determineAppMode();

  if (appMode === AppMode.ENCLAVED) {
    return configureEnclavedMode();
  } else if (appMode === AppMode.MASTER_EXPRESS) {
    return configureMasterExpressMode();
  } else {
    throw new Error(`Unknown app mode: ${appMode}`);
  }
}

// Type guards for working with the union type
export function isEnclavedConfig(config: Config): config is EnclavedConfig {
  return config.appMode === AppMode.ENCLAVED;
}

export function isMasterExpressConfig(config: Config): config is MasterExpressConfig {
  return config.appMode === AppMode.MASTER_EXPRESS;
}
