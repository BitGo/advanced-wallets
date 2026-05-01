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
import https from 'https';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { URL } from 'url';

import logger from '../../shared/logger';

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

  // Handles http errors from key provider
  private errorHandler(error: superagent.ResponseError, errorLog: string) {
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

  async postKey(params: PostKeyParams): Promise<PostKeyResponse> {
    logger.info(
      'Posting key to key provider with pub: %s and source: %s',
      params.pub,
      params.source,
    );

    // Call key provider to post the key
    let response: any;
    try {
      let req = superagent.post(`${this.url}/key`).send(params);
      if (this.agent) req = req.agent(this.agent);
      response = await req;
    } catch (error: any) {
      this.errorHandler(error, 'Error posting key to key provider');
    }

    // validate the response
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

    // Call key provider to get the key
    let response: any;
    try {
      let req = superagent.get(`${this.url}/key/${params.pub}`).query({
        source: params.source,
      });
      if (this.agent) req = req.agent(this.agent);
      response = await req;
    } catch (error: any) {
      this.errorHandler(error, 'Error getting key from key provider');
    }

    // validate the response
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

  async generateDataKey(params: GenerateDataKeyParams): Promise<GenerateDataKeyResponse> {
    logger.info('Generating data key from key provider with type: %s', params.keyType);

    // Call key provider to generate the data key
    let response: any;
    try {
      let req = superagent.post(`${this.url}/generateDataKey`).send(params);
      if (this.agent) req = req.agent(this.agent);
      response = await req;
    } catch (error: any) {
      this.errorHandler(error, 'Error generating data key from key provider');
    }

    // validate the response
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
    // Call key provider to decrypt the data key
    let response: any;
    try {
      let req = superagent.post(`${this.url}/decryptDataKey`).send(params);
      if (this.agent) req = req.agent(this.agent);
      response = await req;
    } catch (error: any) {
      this.errorHandler(error, 'Error decrypting data key from key provider');
    }

    // validate the response
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
