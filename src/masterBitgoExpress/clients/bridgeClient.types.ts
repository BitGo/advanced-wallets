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

const unknownOptional = z.unknown().optional();

export const SubmitResponseSchema = z.object({
  jobId: z.string(),
});
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

export const BridgeJobResponseSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  version: z.number(),
  coin: z.string(),
  operationType: OperationTypeSchema,
  awmResponse: unknownOptional,
  awmBackupResponse: unknownOptional,
  result: unknownOptional,
  error: z.string().optional(),
  currentRound: z.number().optional(),
  totalRounds: z.number().optional(),
  sessionState: unknownOptional,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BridgeJobResponse = z.infer<typeof BridgeJobResponseSchema>;

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
