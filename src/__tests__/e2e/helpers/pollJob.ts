import { MbeJobPollResponse } from '../../../masterBitgoExpress/clients/bridgeClient.types';
import { E2EConfig } from './config';
import { authHeaders, request } from './httpClient';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Poll `fn` until `done(result)` is true, then return that result.
 * Throws once `timeoutMs` elapses.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (result: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 180000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await fn();
    if (done(result)) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil: timed out after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

/** MBE client-facing terminal job states (the bridge maps `expired` -> `failed`). */
const TERMINAL_STATUSES: ReadonlySet<MbeJobPollResponse['status']> = new Set([
  'complete',
  'failed',
]);

/**
 * Poll MBE's client-facing job endpoint until the job reaches a terminal state
 * (`complete` or `failed`). Returns the final poll response — callers assert on
 * `status`/`result`/`error`.
 */
export async function pollJobToTerminal(
  cfg: E2EConfig,
  jobId: string,
  options: PollOptions = {},
): Promise<MbeJobPollResponse> {
  const { accessToken } = cfg;
  if (!accessToken) {
    throw new Error('pollJobToTerminal: accessToken is required (set BITGO_ACCESS_TOKEN)');
  }
  const url = `${cfg.mbeUrl}/api/v1/advancedwallet/job/${jobId}`;

  const result = await pollUntil(
    async () => {
      const res = await request<MbeJobPollResponse>('GET', url, {
        headers: authHeaders(accessToken),
        timeoutMs: cfg.requestTimeoutMs,
      });
      if (res.status !== 200) {
        throw new Error(`pollJobToTerminal: GET ${url} returned ${res.status}`);
      }
      return res.body;
    },
    (job) => TERMINAL_STATUSES.has(job.status),
    {
      intervalMs: options.intervalMs ?? cfg.pollIntervalMs,
      timeoutMs: options.timeoutMs ?? cfg.pollTimeoutMs,
    },
  );

  return result;
}
