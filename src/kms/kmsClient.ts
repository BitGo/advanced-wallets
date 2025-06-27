import debug from 'debug';
import * as superagent from 'superagent';
import { EnclavedConfig, isMasterExpressConfig } from '../shared/types';
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

const debugLogger = debug('bitgo:express:kmsClient');

export class KmsClient {
  private readonly url: string;

  constructor(cfg: EnclavedConfig) {
    if (isMasterExpressConfig(cfg)) {
      throw new Error('Configuration is not in enclaved express mode');
    }

    if (!cfg.kmsUrl) {
      throw new Error('KMS URL not configured. Please set KMS_URL in your environment.');
    }

    this.url = cfg.kmsUrl;
    debugLogger('kmsClient initialized with URL: %s', this.url);
  }

  async postKey(params: PostKeyParams): Promise<PostKeyResponse> {
    debugLogger('Posting key to KMS: %O', params);

    // Call KMS to post the key
    let kmsResponse: any;
    try {
      kmsResponse = await superagent.post(`${this.url}/key`).set('x-api-key', 'abc').send(params);
    } catch (error: any) {
      console.log('Error posting key to KMS', error);
      throw error;
    }

    // validate the response
    try {
      PostKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      throw new Error(
        `KMS returned unexpected response${error.message ? `: ${error.message}` : ''}`,
      );
    }

    const { pub, coin, source } = kmsResponse.body;
    return { pub, coin, source } as PostKeyResponse;
  }

  async getKey(params: GetKeyParams): Promise<GetKeyResponse> {
    debugLogger('Getting key from KMS: %O', params);

    // Call KMS to get the key
    let kmsResponse: any;
    try {
      kmsResponse = await superagent
        .get(`${this.url}/key/${params.pub}`)
        .query({ source: params.source });
    } catch (error: any) {
      console.log('Error getting key from KMS', error);
      throw error;
    }

    // validate the response
    try {
      GetKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      throw new Error(
        `KMS returned unexpected response${error.message ? `: ${error.message}` : ''}`,
      );
    }

    return kmsResponse.body as GetKeyResponse;
  }

  async generateDataKey(params: GenerateDataKeyParams): Promise<GenerateDataKeyResponse> {
    debugLogger('Generating data key from KMS: %O', params);

    // Call KMS to generate the data key
    let kmsResponse: any;
    try {
      kmsResponse = await superagent.post(`${this.url}/generateDataKey`).send(params);
    } catch (error: any) {
      debugLogger('Error generating data key from KMS', error);
      throw error;
    }

    // validate the response
    try {
      GenerateDataKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      throw new Error(
        `KMS returned unexpected response${error.message ? `: ${error.message}` : ''}`,
      );
    }

    return {
      plaintextKey: kmsResponse.body.plaintextKey,
      encryptedKey: kmsResponse.body.encryptedKey,
    };
  }

  async decryptDataKey(params: DecryptDataKeyParams): Promise<DecryptDataKeyResponse> {
    debugLogger('Decrypting data key from KMS: %O', params);

    // Call KMS to decrypt the data key
    let kmsResponse: any;
    try {
      kmsResponse = await superagent.post(`${this.url}/decryptDataKey`).send(params);
    } catch (error: any) {
      debugLogger('Error decrypting data key from KMS', error);
      throw error;
    }

    // validate the response
    try {
      DecryptDataKeyKmsSchema.parse(kmsResponse.body);
    } catch (error: any) {
      throw new Error(
        `KMS returned unexpected response${error.message ? `: ${error.message}` : ''}`,
      );
    }

    return kmsResponse.body as DecryptDataKeyResponse;
  }
}
