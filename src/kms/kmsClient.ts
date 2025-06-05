import debug from 'debug';
import * as superagent from 'superagent';
import { config, isMasterExpressConfig } from '../config';
import { PostKeyKmsSchema, PostKeyParams, PostKeyResponse } from './types/postKey';

const debugLogger = debug('bitgo:express:kmsClient');

export class KmsClient {
  private readonly url: string;

  constructor() {
    const cfg = config();
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

    let kmsResponse: any;
    try {
      kmsResponse = await superagent.post(`${this.url}/key`).set('x-api-key', 'abc').send(params);
    } catch (error: any) {
      console.log('Error posting key to KMS', error);
      throw error;
    }

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
}
