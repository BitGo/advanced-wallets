import superagent from 'superagent';
import https from 'https';
import debug from 'debug';
import { MasterExpressConfig, TlsMode } from '../types';

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
  private readonly sslCert: string;
  private readonly tlsMode: TlsMode;
  private readonly coin?: string;

  constructor(cfg: MasterExpressConfig, coin?: string) {
    if (!cfg.enclavedExpressUrl || !cfg.enclavedExpressCert) {
      throw new Error('enclavedExpressUrl and enclavedExpressCert are required');
    }

    this.baseUrl = cfg.enclavedExpressUrl;
    this.sslCert = cfg.enclavedExpressCert;
    this.tlsMode = cfg.tlsMode;
    this.coin = coin;
    debugLogger('EnclavedExpressClient initialized with URL: %s', this.baseUrl);
  }

  async ping(): Promise<void> {
    try {
      debugLogger('Pinging enclaved express at %s', this.baseUrl);
      await superagent.get(`${this.baseUrl}/ping`).ca(this.sslCert).send();
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
      const { body: keychain } = await superagent
        .post(`${this.baseUrl}/api/${this.coin}/key/independent`)
        .ca(this.sslCert)
        .agent(
          new https.Agent({
            rejectUnauthorized: this.tlsMode === TlsMode.MTLS,
            ca: this.sslCert,
          }),
        )
        .type('json')
        .send(params);

      return keychain;
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
