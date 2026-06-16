import { BadRequestError } from '../../shared/errors';
import {
  BridgeJobResponse,
  JobStatus,
  MBE_JOB_STATUS,
  MbeJobPollResponse,
  MbeJobPollStatus,
} from '../clients/bridgeClient.types';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';

const BRIDGE_TO_MBE_STATUS = {
  awaiting_oso: MBE_JOB_STATUS.awaiting_client,
  awaiting_bitgo: MBE_JOB_STATUS.awaiting_bitgo,
  complete: MBE_JOB_STATUS.complete,
  failed: MBE_JOB_STATUS.failed,
  expired: MBE_JOB_STATUS.failed,
} as const satisfies Record<JobStatus, MbeJobPollStatus>;

function toPollResponse(job: BridgeJobResponse): MbeJobPollResponse {
  return {
    jobId: job.jobId,
    status: BRIDGE_TO_MBE_STATUS[job.status],
    ...(job.status === 'complete' && job.result && { result: job.result }),
    ...(job.status === 'failed' && job.error && { error: job.error }),
    ...(job.status === 'expired' && { error: 'Job expired' }),
    ...(job.currentRound != null && { round: job.currentRound }),
    ...(job.totalRounds != null && { totalRounds: job.totalRounds }),
  };
}

export async function handleGetJob(req: MasterApiSpecRouteRequest<'v1.wallet.getJob', 'get'>) {
  if (!req.config.asyncModeConfig.enabled || !req.bridgeClient) {
    throw new BadRequestError('Job polling requires async mode');
  }
  const bridgeJob = await req.bridgeClient.getJob(req.params.jobId);
  return toPollResponse(bridgeJob);
}
