import { SubmitParams } from '../../clients/bridgeClient.types';
import { BitGoRequest } from '../../../types/request';
import { MasterExpressConfig } from '../../../shared/types';

export const ASYNC_JOB_SUBMITTED_STATUS = 'pending' as const;
export type AsyncJobSubmittedStatus = typeof ASYNC_JOB_SUBMITTED_STATUS;
export type AsyncJobResponse = { jobId: string; status: AsyncJobSubmittedStatus };

/**
 * Submits a signing or keygen job to the bridge and returns { jobId, status: 'pending' }.
 * Returns null when async mode is off — callers must fall through to the sync path in that case.
 */
export async function submitJobViaBridgeClient(
  req: BitGoRequest<MasterExpressConfig>,
  params: SubmitParams,
): Promise<AsyncJobResponse | null> {
  if (!req.config.asyncModeConfig.enabled) return null;
  if (!req.bridgeClient) {
    throw new Error('bridgeClient is required when async mode is enabled');
  }
  const { jobId } = await req.bridgeClient.submit(params);
  return { jobId, status: ASYNC_JOB_SUBMITTED_STATUS };
}
