import * as superagent from 'superagent';
import https from 'https';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from './errors';
import logger from './logger';

export type HttpMethod = 'get' | 'post' | 'patch';

export type QueryArg = Parameters<superagent.Request['query']>[0];
export type BodyArg = Parameters<superagent.Request['send']>[0];
type HeadersArg = Record<string, string>;

type CallOptions<M extends HttpMethod> = M extends 'get'
  ? { query?: QueryArg; headers?: HeadersArg }
  : M extends 'patch'
  ? { body?: BodyArg; query?: QueryArg; headers?: HeadersArg }
  : { body?: BodyArg; headers?: HeadersArg };

export abstract class BaseHttpClient {
  protected readonly url: string;
  private readonly timeout: number;
  private readonly agent?: https.Agent;

  constructor(url: string, timeout: number, agent?: https.Agent) {
    this.url = url.replace(/\/$/, '');
    this.timeout = timeout;
    this.agent = agent;
  }

  protected errorHandler(error: superagent.ResponseError, ctx: string): never {
    logger.error(ctx, error);

    if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'].includes((error as any).code)) {
      throw error;
    }

    switch (error.status) {
      case 400:
        throw new BadRequestError(error.response?.body.message);
      case 401:
        throw new UnauthorizedError(error.response?.body.message);
      case 404:
        throw new NotFoundError(error.response?.body.message);
      case 409:
        throw new ConflictError(error.response?.body.message);
      default:
        throw new Error(
          `${ctx}${error.status ? ` [${error.status}]` : ''}${
            error.response?.body.message ? `: ${error.response.body.message}` : ''
          }`,
        );
    }
  }

  protected async call<M extends HttpMethod>(
    method: M,
    url: string,
    options?: CallOptions<M>,
  ): Promise<superagent.Response> {
    try {
      let req =
        method === 'get'
          ? superagent.get(url).query((options as CallOptions<'get'>)?.query ?? {})
          : method === 'post'
          ? superagent.post(url).send((options as CallOptions<'post'>)?.body)
          : superagent
              .patch(url)
              .send((options as CallOptions<'patch'>)?.body)
              .query((options as CallOptions<'patch'>)?.query ?? {});

      req = req.timeout(this.timeout);

      if (this.agent) {
        req = req.agent(this.agent);
      }

      if (options?.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          req = req.set(key, value);
        }
      }

      return await req;
    } catch (error: any) {
      return this.errorHandler(error, `${method.toUpperCase()} ${url}`);
    }
  }
}
