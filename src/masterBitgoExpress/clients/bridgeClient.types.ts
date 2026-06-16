import { z } from 'zod';
import { UserOrBackupKey } from '../../shared/types';
import { BodyArg } from '../../shared/httpClient';

export const OperationTypeSchema = z.enum([
  'multisig_sign',
  'multisig_keygen',
  'multisig_recovery',
  'mpc_sign',
  'mpc_keygen',
]);
export type OperationType = z.infer<typeof OperationTypeSchema>;

export const JobStatusSchema = z.enum([
  'awaiting_oso',
  'awaiting_bitgo',
  'complete',
  'failed',
  'expired',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const AwmResponseSchema = z.object({
  status: z.number(),
  body: z.record(z.unknown()),
  error: z.string().optional(),
});
export type AwmResponse = z.infer<typeof AwmResponseSchema>;

export const AwmRequestSchema = z.object({
  endpoint: z.string(),
  method: z.string(),
  body: z.record(z.unknown()),
  headers: z.record(z.string()).optional(),
});
export type AwmRequest = z.infer<typeof AwmRequestSchema>;

export const SubmitResponseSchema = z.object({
  jobId: z.string(),
});
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

export const BridgeJobResponseSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  coin: z.string(),
  operationType: OperationTypeSchema,
  request: AwmRequestSchema,
  awmResponse: AwmResponseSchema.optional(),
  awmBackupResponse: AwmResponseSchema.optional(),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  currentRound: z.number().optional(),
  totalRounds: z.number().optional(),
  sessionState: z.record(z.unknown()).optional(),
  version: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  ttl: z.number(),
});
export type BridgeJobResponse = z.infer<typeof BridgeJobResponseSchema>;

/** Fields the MBE poll endpoint reads from GET /job/{jobId}. */
export const BridgeJobPollFieldsSchema = BridgeJobResponseSchema.pick({
  jobId: true,
  status: true,
  result: true,
  error: true,
  currentRound: true,
  totalRounds: true,
});
export type BridgeJobPollFields = z.infer<typeof BridgeJobPollFieldsSchema>;

export const MBE_JOB_STATUS = {
  pending: 'pending',
  awaiting_client: 'awaiting_client',
  awaiting_bitgo: 'awaiting_bitgo',
  complete: 'complete',
  failed: 'failed',
} as const;

type MbeJobStatusMap = typeof MBE_JOB_STATUS;

export type MbeJobStatus = MbeJobStatusMap[keyof MbeJobStatusMap];

export type AsyncJobSubmittedStatus = Pick<MbeJobStatusMap, 'pending'>['pending'];

export const ASYNC_JOB_SUBMITTED_STATUS: AsyncJobSubmittedStatus = MBE_JOB_STATUS.pending;

export type AsyncJobResponse = { jobId: string; status: AsyncJobSubmittedStatus };

export type MbeJobPollStatus = MbeJobStatusMap[keyof Pick<
  MbeJobStatusMap,
  'awaiting_client' | 'awaiting_bitgo' | 'complete' | 'failed'
>];

export type MbeJobPollResponse = {
  jobId: string;
  status: MbeJobPollStatus;
  result?: Record<string, unknown>;
  error?: string;
  round?: number;
  totalRounds?: number;
};

export interface SubmitParams {
  path: string;
  body: BodyArg;
  sources: UserOrBackupKey[];
  operationType: OperationType;
  idempotencyKey?: string;
}

export interface UpdateJobParams {
  jobId: string;
  version: number;
  status: Extract<JobStatus, 'complete' | 'failed'>;
  result?: unknown;
  error?: string;
}

export interface ListJobsParams {
  status?: JobStatus;
}

export interface HealthResponse {
  status: string;
}

export interface BridgeClient {
  submit(params: SubmitParams): Promise<SubmitResponse>;
  getJob(jobId: string): Promise<BridgeJobResponse>;
  updateJob(params: UpdateJobParams): Promise<void>;
  listJobs(params: ListJobsParams): Promise<{ jobs: BridgeJobResponse[] }>;
  health(): Promise<HealthResponse>;
}
