import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { OsoBridgeClient } from '../clients/bridgeClient';
import { AwmResponseSchema, BridgeJobResponse } from '../clients/bridgeClient.types';
import {
  IndependentKeychainResponseSchema,
  type IndependentKeychainResponse,
} from '../clients/advancedWalletManagerClient';
import coinFactory from '../../shared/coinFactory';
import { MasterExpressConfig } from '../../shared/types';
import logger from '../../shared/logger';
import { createOnchainKeyGenCallbackForPreGeneratedKeychains } from '../handlers/walletGenerationCallbacks';

const ASYNC_OPERATIONS_TO_HANDLERS: Partial<
  Record<
    BridgeJobResponse['operationType'],
    (job: BridgeJobResponse, bridge: OsoBridgeClient, bitgo: BitGoAPI) => Promise<void>
  >
> = {
  multisig_keygen: handleKeyGenerationOperation,
};

function parseKeychainFromAwmResponse(
  awmResponse: BridgeJobResponse['awmResponse'],
  field: 'awmResponse' | 'awmBackupResponse',
): IndependentKeychainResponse {
  if (awmResponse === undefined) {
    throw new Error(`job missing ${field}`);
  }
  const envelope = AwmResponseSchema.safeParse(awmResponse);
  if (!envelope.success) {
    throw new Error(`job ${field} is not a valid AwmResponse (expected { status, body })`);
  }
  const r = envelope.data;
  if (r.status >= 400 || r.error) {
    throw new Error(r.error ?? `AWM ${field} returned status ${r.status}`);
  }
  return IndependentKeychainResponseSchema.parse(r.body);
}

export function startAsyncJobWorker(cfg: MasterExpressConfig): () => void {
  const logPrefix = '[asyncJobWorker:startAsyncJobWorker]';
  const bridge = new OsoBridgeClient(cfg.asyncModeConfig.awmAsyncUrl, cfg.timeout);
  const bitgo = new BitGoAPI({
    env: cfg.env,
    customRootURI: cfg.customRootUri,
    accessToken: cfg.bitgoAccessToken,
  });

  let isWorkerRunning = false;
  const handle = setInterval(async () => {
    if (isWorkerRunning) {
      logger.warn(`${logPrefix} previous job still running, skipping this interval`);
      return;
    }
    isWorkerRunning = true;
    try {
      await processPendingJobs(bridge, bitgo);
    } catch (err) {
      logger.error(`${logPrefix} unhandled error: ${JSON.stringify(err)}`);
    } finally {
      isWorkerRunning = false;
    }
  }, cfg.asyncModeConfig.pollIntervalInMs);

  logger.info(`${logPrefix} started, polling every ${cfg.asyncModeConfig.pollIntervalInMs}ms`);
  return () => clearInterval(handle);
}

export async function processPendingJobs(bridge: OsoBridgeClient, bitgo: BitGoAPI): Promise<void> {
  const { jobs } = await bridge.listJobs({ status: 'awaiting_bitgo' });
  if (jobs.length === 0) {
    logger.info('[asyncJobWorker:processPendingJobs] no awaiting_bitgo jobs found');
    return;
  }

  const logPrefix = '[asyncJobWorker:processPendingJobs]';
  logger.info(`${logPrefix} found ${jobs.length} awaiting_bitgo jobs`);

  await Promise.allSettled(jobs.map((job) => processJob(job, bridge, bitgo)));
}

async function processJob(
  job: BridgeJobResponse,
  bridge: OsoBridgeClient,
  bitgo: BitGoAPI,
): Promise<void> {
  const logPrefix = '[asyncJobWorker:processJob]';
  const handler = ASYNC_OPERATIONS_TO_HANDLERS[job.operationType];
  if (!handler) {
    logger.debug(`${logPrefix} no handler for operationType ${job.operationType}, skipping`);
    return;
  }
  try {
    await handler(job, bridge, bitgo);
  } catch (err) {
    logger.error(`${logPrefix} job ${job.jobId} failed: ${JSON.stringify(err)}`);
    await bridge.updateJob({
      jobId: job.jobId,
      version: job.version,
      status: 'failed',
      error: (err as Error).message,
    });
  }
}

export async function handleKeyGenerationOperation(
  job: BridgeJobResponse,
  bridge: OsoBridgeClient,
  bitgo: BitGoAPI,
): Promise<void> {
  const logPrefix = '[asyncJobWorker:handleKeyGenerationOperation]';
  const userKeychain = parseKeychainFromAwmResponse(job.awmResponse, 'awmResponse');
  const backupKeychain = parseKeychainFromAwmResponse(job.awmBackupResponse, 'awmBackupResponse');
  const { jobId, coin, version } = job;

  const baseCoin = await coinFactory.getCoin(coin, bitgo);
  const result = await baseCoin.wallets().generateWallet({
    ...(job.request?.body ?? {}),
    type: 'advanced',
    multisigType: 'onchain',
    createKeychainCallback: createOnchainKeyGenCallbackForPreGeneratedKeychains({
      user: userKeychain,
      backup: backupKeychain,
    }),
  });

  logger.info(`${logPrefix} job ${jobId} created wallet - updating job status to complete`);
  const walletId = result.wallet.toJSON().id;

  await bridge.updateJob({
    jobId,
    version,
    status: 'complete',
    result: { walletId },
  });

  logger.info(`${logPrefix} job ${jobId} complete, walletId ${walletId}`);
}
