import * as superagent from 'superagent';
import { AdvancedWalletManagerConfig, isMasterExpressConfig, TlsMode } from '../shared/types';
import { PostKeyKmsSchema, PostKeyParams, PostKeyResponse } from './types/postKey';
import { GetKeyKmsSchema, GetKeyParams, GetKeyResponse } from './types/getKey';
import {
  DecryptDataKeyKmsSchema,
  DecryptDataKeyParams,
  DecryptDataKeyResponse,
} from './types/dataKey';
import {
  GenerateDataKeyKmsSchema,
  GenerateDataKeyParams,
  GenerateDataKeyResponse,
} from './types/generateDataKey';
import https from 'https';
import { BadRequestError, ConflictError, NotFoundError } from '../shared/errors';
import { URL } from 'url';

import logger from '../logger';

export class KmsClient {
  private readonly url: string;
  private readonly agent?: https.Agent;

  constructor(cfg: AdvancedWalletManagerConfig) {
    if (isMasterExpressConfig(cfg)) {
      logger.error('KMS client cannot be initialized in master express mode');
      throw new Error('Configuration is not in advanced wallet manager mode');
    }
    if (!cfg.kmsUrl) {
      logger.error('KMS URL not configured. Please set KMS_URL in your environment.');
      throw new Error('KMS URL not configured. Please set KMS_URL in your environment.');
    }

    const kmsUrlObj = new URL(cfg.kmsUrl);
    if (cfg.tlsMode === TlsMode.MTLS) {
      kmsUrlObj.protocol = 'https:';
      if (cfg.kmsTlsCert || cfg.kmsServerCertAllowSelfSigned) {
        this.agent = new https.Agent({
          ca: cfg.kmsTlsCert,
          cert: cfg.tlsCert,
          key: cfg.tlsKey,
          rejectUnauthorized: !cfg.kmsServerCertAllowSelfSigned,
        });
      }
    } else {
      kmsUrlObj.protocol = 'http:';
    }

    this.url = kmsUrlObj.toString().replace(/\/$/, '');
    logger.info('kmsClient initialized with URL: %s', this.url);
  }

  // Handles http erros from KMS
  private errorHandler(error: superagent.ResponseError, errorLog: string) {
    logger.error(errorLog, error);
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
          `KMS returned unexpected response.${error.status ? ` ${error.status}` : ''}${
            error.response?.body.message ? `: ${error.response?.body.message}` : ''
          }`,
        );
    }
  }

  async postKey(params: PostKeyParams): Promise<PostKeyResponse> {
    logger.info('Posting key to KMS with pub: %s and source: %s', params.pub, params.source);

    // Call KMS to post the key
    let kmsResponse: any;
    try {
      let req = superagent.post(`${this.url}/key`).send(params);
      if (this.agent) req = req.agent(this.agent);
      kmsResponse = await req;
    } catch (error: any) {
      this.errorHandler(error, 'Error posting key to KMS');
    }

    // validate the response
    try {
      PostKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      logger.error('KMS returned unexpected when posting key: ', error);
      throw new Error(
        `KMS returned unexpected response when posting key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    const { pub, coin, source } = kmsResponse.body;
    return { pub, coin, source } as PostKeyResponse;
  }

  async getKey(params: GetKeyParams): Promise<GetKeyResponse> {
    logger.info('Getting key from KMS with pub: %s and source: %s', params.pub, params.source);

    // Call KMS to get the key
    let kmsResponse: any;
    try {
      let req = superagent.get(`${this.url}/key/${params.pub}`).query({
        source: params.source,
      });
      if (this.agent) req = req.agent(this.agent);
      kmsResponse = await req;
    } catch (error: any) {
      console.log('Error getting key from KMS:', error);
      this.errorHandler(error, 'Error getting key from KMS');
    }

    // validate the response
    try {
      GetKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      logger.error('KMS returned unexpected response when getting key', error);
      throw new Error(
        `KMS returned unexpected response when getting key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return kmsResponse.body as GetKeyResponse;
  }

  async generateDataKey(params: GenerateDataKeyParams): Promise<GenerateDataKeyResponse> {
    logger.info('Generating data key from KMS with type: %s', params.keyType);

    // Call KMS to generate the data key
    let kmsResponse: any;
    try {
      let req = superagent.post(`${this.url}/generateDataKey`).send(params);
      if (this.agent) req = req.agent(this.agent);
      kmsResponse = await req;
    } catch (error: any) {
      this.errorHandler(error, 'Error generating data key from KMS');
    }

    // validate the response
    try {
      GenerateDataKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      logger.error('KMS returned unexpected response when generating data key', error);
      throw new Error(
        `KMS returned unexpected response when generating data key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return {
      plaintextKey: kmsResponse.body.plaintextKey,
      encryptedKey: kmsResponse.body.encryptedKey,
    };
  }

  async decryptDataKey(params: DecryptDataKeyParams): Promise<DecryptDataKeyResponse> {
    logger.info('Decrypting data key from KMS');

    // Call KMS to decrypt the data key
    let kmsResponse: any;
    try {
      let req = superagent.post(`${this.url}/decryptDataKey`).send(params);
      if (this.agent) req = req.agent(this.agent);
      kmsResponse = await req;
    } catch (error: any) {
      this.errorHandler(error, 'Error decrypting data key from KMS');
    }

    // validate the response
    try {
      DecryptDataKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      logger.error('KMS returned unexpected response when decrypting data key', error);
      throw new Error(
        `KMS returned unexpected response when decrypting data key${
          error.message ? `: ${error.message}` : ''
        }`,
      );
    }

    return kmsResponse.body as DecryptDataKeyResponse;
  }
}
