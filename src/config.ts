import fs from 'fs';
import {
  Config,
  EnclavedConfig,
  MasterExpressConfig,
  TlsMode,
  AppMode,
  EnvironmentName,
} from './types';
import logger from './logger';

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
  tlsMode: TlsMode.MTLS,
  mtlsRequestCert: true,
  allowSelfSigned: false,
};

function determineTlsMode(): TlsMode {
  const disableTls = readEnvVar('MASTER_BITGO_EXPRESS_DISABLE_TLS') === 'true';
  if (disableTls) return TlsMode.DISABLED;
  return TlsMode.MTLS;
}

function enclavedEnvConfig(): Partial<EnclavedConfig> {
  const kmsUrl = readEnvVar('KMS_URL');

  if (!kmsUrl) {
    logger.error('KMS_URL environment variable is required and cannot be empty');
    throw new Error('KMS_URL environment variable is required and cannot be empty');
  }

  return {
    appMode: AppMode.ENCLAVED,
    port: Number(readEnvVar('ENCLAVED_EXPRESS_PORT')),
    bind: readEnvVar('BIND'),
    ipc: readEnvVar('IPC'),
    debugNamespace: (readEnvVar('DEBUG_NAMESPACE') || '').split(',').filter(Boolean),
    logFile: readEnvVar('LOGFILE'),
    timeout: Number(readEnvVar('TIMEOUT')),
    keepAliveTimeout: Number(readEnvVar('KEEP_ALIVE_TIMEOUT')),
    headersTimeout: Number(readEnvVar('HEADERS_TIMEOUT')),
    // KMS settings
    kmsUrl,
    // mTLS settings
    keyPath: readEnvVar('TLS_KEY_PATH'),
    crtPath: readEnvVar('TLS_CERT_PATH'),
    tlsKey: readEnvVar('TLS_KEY'),
    tlsCert: readEnvVar('TLS_CERT'),
    tlsMode: determineTlsMode(),
    mtlsRequestCert: readEnvVar('MTLS_REQUEST_CERT')?.toLowerCase() !== 'false',
    mtlsAllowedClientFingerprints: readEnvVar('MTLS_ALLOWED_CLIENT_FINGERPRINTS')?.split(','),
    allowSelfSigned: readEnvVar('ALLOW_SELF_SIGNED') === 'true',
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
    mtlsAllowedClientFingerprints: get('mtlsAllowedClientFingerprints'),
    allowSelfSigned: get('allowSelfSigned'),
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
  port: 3081,
  bind: 'localhost',
  timeout: 305 * 1000,
  logFile: '',
  env: 'test',
  disableEnvCheck: true,
  authVersion: 2,
  enclavedExpressUrl: '', // Will be overridden by environment variable
  enclavedExpressCert: '', // Will be overridden by environment variable
  tlsMode: TlsMode.MTLS,
  mtlsRequestCert: true,
  allowSelfSigned: false,
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
  const enclavedExpressCert = readEnvVar('ENCLAVED_EXPRESS_CERT');

  if (!enclavedExpressUrl) {
    throw new Error('ENCLAVED_EXPRESS_URL environment variable is required and cannot be empty');
  }

  if (!enclavedExpressCert) {
    throw new Error('ENCLAVED_EXPRESS_CERT environment variable is required and cannot be empty');
  }

  // Debug mTLS environment variables
  const mtlsRequestCertRaw = readEnvVar('MTLS_REQUEST_CERT');
  const allowSelfSignedRaw = readEnvVar('ALLOW_SELF_SIGNED');
  const mtlsRequestCert = mtlsRequestCertRaw?.toLowerCase() !== 'false';
  const allowSelfSigned = allowSelfSignedRaw === 'true';

  return {
    appMode: AppMode.MASTER_EXPRESS,
    port: Number(readEnvVar('MASTER_EXPRESS_PORT')),
    bind: readEnvVar('BIND'),
    ipc: readEnvVar('IPC'),
    debugNamespace: (readEnvVar('DEBUG_NAMESPACE') || '').split(',').filter(Boolean),
    logFile: readEnvVar('LOGFILE'),
    timeout: Number(readEnvVar('TIMEOUT')),
    keepAliveTimeout: Number(readEnvVar('KEEP_ALIVE_TIMEOUT')),
    headersTimeout: Number(readEnvVar('HEADERS_TIMEOUT')),
    // BitGo API settings
    env: readEnvVar('BITGO_ENV') as EnvironmentName,
    customRootUri: readEnvVar('BITGO_CUSTOM_ROOT_URI'),
    disableEnvCheck: readEnvVar('BITGO_DISABLE_ENV_CHECK') === 'true',
    authVersion: Number(readEnvVar('BITGO_AUTH_VERSION')),
    enclavedExpressUrl,
    enclavedExpressCert,
    customBitcoinNetwork: readEnvVar('BITGO_CUSTOM_BITCOIN_NETWORK'),
    // mTLS settings
    keyPath: readEnvVar('TLS_KEY_PATH'),
    crtPath: readEnvVar('TLS_CERT_PATH'),
    tlsKey: readEnvVar('TLS_KEY'),
    tlsCert: readEnvVar('TLS_CERT'),
    tlsMode: determineTlsMode(),
    mtlsRequestCert,
    mtlsAllowedClientFingerprints: readEnvVar('MTLS_ALLOWED_CLIENT_FINGERPRINTS')?.split(','),
    allowSelfSigned,
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
    disableEnvCheck: get('disableEnvCheck'),
    authVersion: get('authVersion'),
    enclavedExpressUrl: get('enclavedExpressUrl'),
    enclavedExpressCert: get('enclavedExpressCert'),
    customBitcoinNetwork: get('customBitcoinNetwork'),
    keyPath: get('keyPath'),
    crtPath: get('crtPath'),
    tlsKey: get('tlsKey'),
    tlsCert: get('tlsCert'),
    tlsMode: get('tlsMode'),
    mtlsRequestCert: get('mtlsRequestCert'),
    mtlsAllowedClientFingerprints: get('mtlsAllowedClientFingerprints'),
    allowSelfSigned: get('allowSelfSigned'),
  };
}

export function configureMasterExpressMode(): MasterExpressConfig {
  const env = masterExpressEnvConfig();
  let config = mergeMasterExpressConfigs(env);

  // Post-process URLs to ensure they use HTTPS
  const updates: Partial<MasterExpressConfig> = {};
  if (config.customRootUri) {
    updates.customRootUri = forceSecureUrl(config.customRootUri);
  }
  if (config.enclavedExpressUrl) {
    updates.enclavedExpressUrl = forceSecureUrl(config.enclavedExpressUrl);
  }
  config = { ...config, ...updates };

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

  // Handle cert loading
  if (config.enclavedExpressCert) {
    try {
      if (fs.existsSync(config.enclavedExpressCert)) {
        config = {
          ...config,
          enclavedExpressCert: fs.readFileSync(config.enclavedExpressCert, 'utf-8'),
        };
      } else {
        throw new Error(`Certificate file not found: ${config.enclavedExpressCert}`);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`Failed to read enclaved express cert: ${err.message}`);
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
