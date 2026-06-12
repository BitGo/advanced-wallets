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
import { URL } from 'url';
import logger from '../../shared/logger';
import { BaseHttpClient } from '../../shared/httpClient';

export class KeyProviderClient extends BaseHttpClient {
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
    let agent: https.Agent | undefined;

    if (cfg.tlsMode === TlsMode.MTLS) {
      urlObj.protocol = 'https:';
      if (cfg.keyProviderServerCaCert || cfg.keyProviderServerCertAllowSelfSigned) {
        agent = new https.Agent({
          ca: cfg.keyProviderServerCaCert,
          cert: cfg.keyProviderClientTlsCert,
          key: cfg.keyProviderClientTlsKey,
          rejectUnauthorized: !cfg.keyProviderServerCertAllowSelfSigned,
        });
      }
    } else {
      urlObj.protocol = 'http:';
    }

    super(urlObj.toString(), cfg.timeout, agent);
  }

  async postKey(params: PostKeyParams): Promise<PostKeyResponse> {
    logger.info(
      'Posting key to key provider with pub: %s and source: %s',
      params.pub,
      params.source,
    );

    const response = await this.call('post', `${this.url}/key`, { body: params });

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

    const { pub, coin, source, type } = response.body;
    return { pub, coin, source, type } as PostKeyResponse;
  }

  async getKey(params: GetKeyParams): Promise<GetKeyResponse> {
    logger.info(
      'Getting key from key provider with pub: %s and source: %s',
      params.pub,
      params.source,
    );

    const response = await this.call('get', `${this.url}/key/${params.pub}`, {
      query: { source: params.source },
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

    const response = await this.call('post', `${this.url}/key/generate`, { body: params });

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

    const response = await this.call('post', `${this.url}/sign`, { body: params });

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

    const response = await this.call('post', `${this.url}/generateDataKey`, { body: params });

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
    const response = await this.call('post', `${this.url}/decryptDataKey`, { body: params });

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
