import { httpRequest, HttpResponse, httpRoute } from '@api-ts/io-ts-http';
import * as t from 'io-ts';
import { ErrorResponses } from '../../shared/errors';
import { MBE_JOB_STATUS } from '../clients/bridgeClient.types';

const MbeJobPollStatusCodec = t.union([
  t.literal(MBE_JOB_STATUS.awaiting_client),
  t.literal(MBE_JOB_STATUS.awaiting_bitgo),
  t.literal(MBE_JOB_STATUS.complete),
  t.literal(MBE_JOB_STATUS.failed),
]);

const MbeJobPollResponseCodec = t.intersection([
  t.type({
    jobId: t.string,
    status: MbeJobPollStatusCodec,
  }),
  t.partial({
    result: t.record(t.string, t.unknown),
    error: t.string,
    round: t.number,
    totalRounds: t.number,
  }),
]);

const JobPollResponse: HttpResponse = {
  200: MbeJobPollResponseCodec,
  ...ErrorResponses,
};

/**
 * Fetch job status for a given job ID.
 * @tag Advanced Wallets
 * @operationId advancedwallet.getJob
 */
export const JobPollRoute = httpRoute({
  method: 'GET',
  path: '/api/v1/advancedwallet/job/{jobId}',
  request: httpRequest({
    params: { jobId: t.string },
  }),
  response: JobPollResponse,
  description: 'Get async job status and result',
});
