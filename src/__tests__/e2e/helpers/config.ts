import { EnvironmentName } from '@bitgo-beta/sdk-core';

/**
 * Resolved configuration for the E2E suite.
 *
 * Unlike the integration suite (which boots mock servers in-process on random
 * ports), the E2E suite points at real, already-running services — typically
 * the local docker-compose env — and a real WP testnet. Everything is
 * therefore sourced from the environment, with local-compose defaults.
 */
export interface E2EConfig {
  /** Master BitGo Express — the client-facing entry point for submit/poll. */
  mbeUrl: string;
  /** OSO bridge — used directly by resilience scenarios. */
  bridgeUrl: string;
  /** Frontend plugin (conductor-facing pull/ack). */
  fePluginUrl: string;
  /** Backend plugin (AWM-facing). */
  bePluginUrl: string;
  /** Advanced Wallet Manager (user key). */
  awmUrl: string;
  /** Advanced Wallet Manager (backup key). */
  awmBackupUrl: string;
  /** Mock Key Provider (HSM stand-in). */
  keyProviderUrl: string;

  /** Coin to exercise. */
  coin: string;
  /** BitGo environment for testnet verification. */
  bitgoEnv: EnvironmentName;
  /** Access token for WP testnet calls. Required by scenarios, not by the harness itself. */
  accessToken?: string;
  /** Enterprise id for keygen scenarios. */
  enterprise?: string;
  /** Pre-funded wallet id for signing scenarios (optional — scenarios may create one). */
  walletId?: string;
  /** Passphrase for the pre-funded wallet. */
  walletPassphrase?: string;

  /** Per-request timeout for HTTP calls. */
  requestTimeoutMs: number;
  /** Delay between job polls. */
  pollIntervalMs: number;
  /** Overall budget for a job to reach a terminal state. */
  pollTimeoutMs: number;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function num(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`E2E config: ${name} must be a number, got "${value}"`);
  }
  return parsed;
}

/** Build the E2E config from the environment. Never throws on missing credentials. */
export function loadE2EConfig(): E2EConfig {
  return {
    mbeUrl: env('E2E_MBE_URL', 'http://localhost:3081'),
    bridgeUrl: env('E2E_BRIDGE_URL', 'http://localhost:3082'),
    fePluginUrl: env('E2E_FE_PLUGIN_URL', 'http://localhost:4001'),
    bePluginUrl: env('E2E_BE_PLUGIN_URL', 'http://localhost:4002'),
    awmUrl: env('E2E_AWM_URL', 'http://localhost:3080'),
    awmBackupUrl: env('E2E_AWM_BACKUP_URL', 'http://localhost:3083'),
    keyProviderUrl: env('E2E_KEY_PROVIDER_URL', 'http://localhost:3000'),

    coin: env('E2E_COIN', 'tbtc'),
    bitgoEnv: env('E2E_BITGO_ENV', 'test') as EnvironmentName,
    accessToken: process.env.BITGO_ACCESS_TOKEN,
    enterprise: process.env.E2E_ENTERPRISE,
    walletId: process.env.E2E_WALLET_ID,
    walletPassphrase: process.env.E2E_WALLET_PASSPHRASE,

    requestTimeoutMs: num('E2E_REQUEST_TIMEOUT_MS', 30000),
    pollIntervalMs: num('E2E_POLL_INTERVAL_MS', 2000),
    pollTimeoutMs: num('E2E_POLL_TIMEOUT_MS', 180000),
  };
}

/**
 * Assert that the fields a scenario needs are present. Call from a scenario's
 * `before()` hook so the harness itself (and the smoke test) can load config
 * without credentials.
 */
export function requireConfig(cfg: E2EConfig, keys: (keyof E2EConfig)[]): void {
  const missing = keys.filter((key) => cfg[key] === undefined || cfg[key] === '');
  if (missing.length > 0) {
    throw new Error(
      `E2E config missing required values: ${missing.join(', ')}. ` +
        `Set the corresponding env vars (see src/__tests__/e2e/README.md).`,
    );
  }
}
