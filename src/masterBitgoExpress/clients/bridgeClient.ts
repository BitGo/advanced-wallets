import { z } from 'zod';
import { BaseHttpClient } from '../../shared/httpClient';
import logger from '../../shared/logger';
import {
  BridgeJobResponse,
  BridgeJobResponseSchema,
  ListJobsParams,
  SubmitParams,
  SubmitResponse,
  SubmitResponseSchema,
  UpdateJobParams,
} from './bridgeClient.types';

export class BridgeClient extends BaseHttpClient {
  constructor(url: string, timeout: number) {
    if (!url) {
      throw new Error('BridgeClient: awmAsyncUrl is required');
    }
    super(url, timeout);
  }

  private parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, ctx: string): T {
    try {
      return schema.parse(data);
    } catch (error: any) {
      throw new Error(
        `bridge returned unexpected response for ${ctx}${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }
  }

  async submit(params: SubmitParams): Promise<SubmitResponse> {
    const path = params.path.startsWith('/') ? params.path : `/${params.path}`;
    const headers: Record<string, string> = {
      'X-OSO-Source': params.sources.join(','),
      'X-OSO-Operation': params.operationType,
    };
    if (params.idempotencyKey) {
      headers['X-Idempotency-Key'] = params.idempotencyKey;
    }

    const response = await this.call('post', `${this.url}${path}`, {
      body: params.body,
      headers,
    });

    return this.parseOrThrow(SubmitResponseSchema, response.body, 'submit');
  }

  async getJob(jobId: string): Promise<BridgeJobResponse> {
    logger.debug('bridge getJob: %s', jobId);

    const response = await this.call('get', `${this.url}/job/${jobId}`);

    return this.parseOrThrow(BridgeJobResponseSchema, response.body, `getJob ${jobId}`);
  }

  async updateJob(params: UpdateJobParams): Promise<void> {
    logger.debug('bridge updateJob: %s -> %s', params.jobId, params.status);

    const { jobId, ...body } = params;
    await this.call('patch', `${this.url}/job/${jobId}`, { body });
  }

  async listJobs(params: ListJobsParams): Promise<{ jobs: BridgeJobResponse[] }> {
    const query: Record<string, string> = {};
    if (params.status) {
      query.status = params.status;
    }

    const response = await this.call('get', `${this.url}/jobs`, { query });

    const jobs: BridgeJobResponse[] = [];
    for (const job of response.body?.jobs ?? []) {
      jobs.push(this.parseOrThrow(BridgeJobResponseSchema, job, 'listJobs job shape'));
    }
    return { jobs };
  }

  async health(): Promise<unknown> {
    const response = await this.call('get', `${this.url}/health`);
    return response.body;
  }
}
