import superagent from 'superagent';
import https from 'https';
import debug from 'debug';
import { MasterExpressConfig } from '../types';
import { TlsMode } from '../types';

const debugLogger = debug('bitgo:express:enclavedExpressClient');

interface CreateIndependentKeychainParams {
  source: 'user' | 'backup';
  coin?: string;
  type: 'independent';
  seed?: string;
}

export interface IndependentKeychainResponse {
  id: string;
  pub: string;
  encryptedPrv?: string;
  type: 'independent';
  source: 'user' | 'backup' | 'bitgo';
  coin: string;
}

export class EnclavedExpressClient {
  private readonly baseUrl: string;
  private readonly enclavedExpressCert: string;
  private readonly tlsKey?: string;
  private readonly tlsCert?: string;
  private readonly allowSelfSigned: boolean;
  private readonly coin?: string;
  private readonly tlsMode: TlsMode;

  constructor(cfg: MasterExpressConfig, coin?: string) {
    if (!cfg.enclavedExpressUrl || !cfg.enclavedExpressCert) {
      throw new Error('enclavedExpressUrl and enclavedExpressCert are required');
    }
    if (cfg.tlsMode === TlsMode.MTLS && (!cfg.tlsKey || !cfg.tlsCert)) {
      throw new Error('tlsKey and tlsCert are required for mTLS communication');
    }

    this.baseUrl = cfg.enclavedExpressUrl;
    this.enclavedExpressCert = cfg.enclavedExpressCert;
    this.tlsKey = cfg.tlsKey;
    this.tlsCert = cfg.tlsCert;
    this.allowSelfSigned = cfg.allowSelfSigned ?? false;
    this.coin = coin;
    this.tlsMode = cfg.tlsMode;
    debugLogger('EnclavedExpressClient initialized with URL: %s', this.baseUrl);
  }

  private createHttpsAgent(): https.Agent {
    if (!this.tlsKey || !this.tlsCert) {
      throw new Error('TLS key and certificate are required for HTTPS agent');
    }
    return new https.Agent({
      rejectUnauthorized: !this.allowSelfSigned,
      ca: this.enclavedExpressCert,
      // Use Master Express's own certificate as client cert when connecting to Enclaved Express
      key: this.tlsKey,
      cert: this.tlsCert,
    });
  }

  async ping(): Promise<void> {
    try {
      debugLogger('Pinging enclaved express at %s', this.baseUrl);
      if (this.tlsMode === TlsMode.MTLS) {
        await superagent.get(`${this.baseUrl}/ping`).agent(this.createHttpsAgent()).send();
      } else {
        // When TLS is disabled, use plain HTTP without any TLS configuration
        await superagent.get(`${this.baseUrl}/ping`).send();
      }
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to ping enclaved express: %s', err.message);
      throw err;
    }
  }

  /**
   * Create an independent multisig key for a given source and coin
   */
  async createIndependentKeychain(
    params: CreateIndependentKeychainParams,
  ): Promise<IndependentKeychainResponse> {
    if (!this.coin) {
      throw new Error('Coin must be specified to create an independent keychain');
    }

    try {
      debugLogger('Creating independent keychain for coin: %s', this.coin);
      let response;
      if (this.tlsMode === TlsMode.MTLS) {
        response = await superagent
          .post(`${this.baseUrl}/api/${this.coin}/key/independent`)
          .agent(this.createHttpsAgent())
          .type('json')
          .send(params);
      } else {
        // When TLS is disabled, use plain HTTP without any TLS configuration
        response = await superagent
          .post(`${this.baseUrl}/api/${this.coin}/key/independent`)
          .type('json')
          .send(params);
      }

      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to create independent keychain: %s', err.message);
      throw err;
    }
  }
}

/**
 * Create an enclaved express client if the configuration is present
 */
export function createEnclavedExpressClient(
  cfg: MasterExpressConfig,
  coin?: string,
): EnclavedExpressClient | undefined {
  try {
    return new EnclavedExpressClient(cfg, coin);
  } catch (error) {
    const err = error as Error;
    debugLogger('Failed to create enclaved express client: %s', err.message);
    return undefined;
  }
}
