import * as superagent from 'superagent';
import { AdvancedWalletManagerConfig, isMasterExpressConfig, TlsMode } from '../../shared/types';
import { PostKeyResponseSchema, PostKeyParams, PostKeyResponse } from './types/postKey';
import { GetKeyResponseSchema, GetKeyParams, GetKeyResponse } from './types/getKey';

import {
  DecryptDataKeyResponseSchema,
  DecryptDataKeyParams,
  DecryptDataKeyResponse,
} from './types/dataKey';
import {
  GenerateDataKeyResponseSchema,
  GenerateDataKeyParams,
  GenerateDataKeyResponse,
} from './types/generateDataKey';
import {
  GenerateKeyResponseSchema,
  GenerateKeyParams,
  GenerateKeyResponse,
} from './types/generateKey';
import { SignResponseSchema, SignParams, SignResponse } from './types/sign';
import https from 'https';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { URL } from 'url';

import logger from '../../shared/logger';

type QueryArg = Parameters<superagent.Request['query']>[0];
type BodyArg = Parameters<superagent.Request['send']>[0];

export class KeyProviderClient {
  private readonly url: string;
  private readonly agent?: https.Agent;

  constructor(cfg: AdvancedWalletManagerConfig) {
    if (isMasterExpressConfig(cfg)) {
      logger.error('key provider client cannot be initialized in master express mode');
      throw new Error('Configuration is not in advanced wallet manager mode');
    }
    if (!cfg.keyProviderUrl) {
      logger.error(
        'key provider URL not configured. Please set KEY_PROVIDER_URL in your environment.',
      );
      throw new Error(
        'key provider URL not configured. Please set KEY_PROVIDER_URL in your environment.',
      );
    }

    const urlObj = new URL(cfg.keyProviderUrl);
    if (cfg.tlsMode === TlsMode.MTLS) {
      urlObj.protocol = 'https:';
      if (cfg.keyProviderServerCaCert || cfg.keyProviderServerCertAllowSelfSigned) {
        this.agent = new https.Agent({
          ca: cfg.keyProviderServerCaCert,
          cert: cfg.keyProviderClientTlsCert,
          key: cfg.keyProviderClientTlsKey,
          rejectUnauthorized: !cfg.keyProviderServerCertAllowSelfSigned,
        });
      }
    } else {
      urlObj.protocol = 'http:';
    }

    this.url = urlObj.toString().replace(/\/$/, '');
  }

  private errorHandler(error: superagent.ResponseError, errorLog: string): never {
    logger.error(errorLog, error);

    if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'].includes((error as any).code)) {
      throw error;
    }

    switch (error.status) {
      case 400:
        throw new BadRequestError(error.response?.body.message);
      case 404:
        throw new NotFoundError(error.response?.body.message);
      case 409:
        throw new ConflictError(error.response?.body.message);
      case 500:
        throw new Error(error.response?.body.message);
      default:
        throw new Error(
          `key provider returned unexpected response.${error.status ? ` ${error.status}` : ''}${
            error.response?.body.message ? `: ${error.response?.body.message}` : ''
          }`,
        );
    }
  }

  private async call<M extends 'get' | 'post'>(
    method: M,
    url: string,
    options: { errorContext: string } & (M extends 'get'
      ? { query?: QueryArg }
      : { body?: BodyArg }),
  ): Promise<superagent.Response> {
    try {
      let req =
        method === 'get'
          ? superagent.get(url).query((options as unknown as { query?: QueryArg }).query ?? {})
          : superagent.post(url).send((options as unknown as { body?: BodyArg }).body);
      if (this.agent) req = req.agent(this.agent);
      return await req;
    } catch (error: any) {
      this.errorHandler(error, options.errorContext);
    }
  }

  async postKey(params: PostKeyParams): Promise<PostKeyResponse> {
    logger.info(
      'Posting key to key provider with pub: %s and source: %s',
      params.pub,
      params.source,
    );

    const response = await this.call('post', `${this.url}/key`, {
      body: params,
      errorContext: 'Error posting key to key provider',
    });

    try {
      PostKeyResponseSchema.parse(response.body);
    } catch (error: any) {
      logger.error('key provider returned unexpected when posting key: ', error);
      throw new Error(
        `key provider returned unexpected response when posting key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    const { pub, coin, source } = response.body;
    return { pub, coin, source } as PostKeyResponse;
  }

  async getKey(params: GetKeyParams): Promise<GetKeyResponse> {
    logger.info(
      'Getting key from key provider with pub: %s and source: %s',
      params.pub,
      params.source,
    );

    const response = await this.call('get', `${this.url}/key/${params.pub}`, {
      query: { source: params.source },
      errorContext: 'Error getting key from key provider',
    });

    try {
      GetKeyResponseSchema.parse(response.body);
    } catch (error: any) {
      logger.error('key provider returned unexpected response when getting key', error);
      throw new Error(
        `key provider returned unexpected response when getting key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return response.body as GetKeyResponse;
  }

  async generateKey(params: GenerateKeyParams): Promise<GenerateKeyResponse> {
    logger.info(
      'Generating key via key provider with coin: %s and source: %s',
      params.coin,
      params.source,
    );

    const response = await this.call('post', `${this.url}/key/generate`, {
      body: params,
      errorContext: 'Error generating key via key provider',
    });

    try {
      GenerateKeyResponseSchema.parse(response.body);
    } catch (error: any) {
      logger.error('key provider returned unexpected response when generating key', error);
      throw new Error(
        `key provider returned unexpected response when generating key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return response.body as GenerateKeyResponse;
  }

  async sign(params: SignParams): Promise<SignResponse> {
    logger.info('Signing via key provider with pub: %s and source: %s', params.pub, params.source);

    const response = await this.call('post', `${this.url}/sign`, {
      body: params,
      errorContext: 'Error signing via key provider',
    });

    try {
      SignResponseSchema.parse(response.body);
    } catch (error: any) {
      logger.error('key provider returned unexpected response when signing', error);
      throw new Error(
        `key provider returned unexpected response when signing${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return response.body as SignResponse;
  }

  async generateDataKey(params: GenerateDataKeyParams): Promise<GenerateDataKeyResponse> {
    logger.info('Generating data key from key provider with type: %s', params.keyType);

    const response = await this.call('post', `${this.url}/generateDataKey`, {
      body: params,
      errorContext: 'Error generating data key from key provider',
    });

    try {
      GenerateDataKeyResponseSchema.parse(response.body);
    } catch (error: any) {
      logger.error('key provider returned unexpected response when generating data key', error);
      throw new Error(
        `key provider returned unexpected response when generating data key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return {
      plaintextKey: response.body.plaintextKey,
      encryptedKey: response.body.encryptedKey,
    };
  }

  async decryptDataKey(params: DecryptDataKeyParams): Promise<DecryptDataKeyResponse> {
    const response = await this.call('post', `${this.url}/decryptDataKey`, {
      body: params,
      errorContext: 'Error decrypting data key from key provider',
    });

    try {
      DecryptDataKeyResponseSchema.parse(response.body);
    } catch (error: any) {
      logger.error('key provider returned unexpected response when decrypting data key', error);
      throw new Error(
        `key provider returned unexpected response when decrypting data key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return response.body as DecryptDataKeyResponse;
  }
}
