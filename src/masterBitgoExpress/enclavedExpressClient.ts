import * as superagent from 'superagent';
import debug from 'debug';
import { config } from '../config';
import { isMasterExpressConfig } from '../types';
import https from 'https';

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
  private readonly url: string;
  private readonly sslCert: string;
  private readonly coin?: string;
  private readonly enableSSL: boolean;

  constructor(coin?: string) {
    const cfg = config();
    if (!isMasterExpressConfig(cfg)) {
      throw new Error('Configuration is not in master express mode');
    }

    if (!cfg.enclavedExpressUrl || !cfg.enclavedExpressSSLCert) {
      throw new Error(
        'Enclaved Express URL not configured. Please set BITGO_ENCLAVED_EXPRESS_URL and BITGO_ENCLAVED_EXPRESS_SSL_CERT in your environment.',
      );
    }

    this.url = cfg.enclavedExpressUrl;
    this.sslCert = cfg.enclavedExpressSSLCert;
    this.coin = coin;
    this.enableSSL = !!cfg.enableSSL;
    debugLogger('EnclavedExpressClient initialized with URL: %s', this.url);
  }

  async ping(): Promise<void> {
    try {
      debugLogger('Pinging enclaved express at %s', this.url);
      await superagent.get(`${this.url}/ping`).ca(this.sslCert).send();
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to ping enclaved express: %s', err.message);
      throw new Error(`Failed to ping enclaved express: ${err.message}`);
    }
  }

  /**
   * Create an independent multisig key for a given source and coin
   */
  async createIndependentKeychain(
    params: CreateIndependentKeychainParams,
  ): Promise<IndependentKeychainResponse> {
    if (!this.coin) {
      throw new Error('Coin not configured');
    }
    try {
      debugLogger('Creating independent keychain for coin: %s', this.coin);
      const { body: keychain } = await superagent
        .post(`${this.url}/api/${this.coin}/key/independent`)
        .ca(this.sslCert)
        .agent(
          new https.Agent({
            rejectUnauthorized: this.enableSSL,
            ca: this.sslCert,
          }),
        )
        .type('json')
        .send(params);
      return keychain;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to create independent keychain: %s', err.message);
      throw new Error(`Failed to create independent keychain: ${err.message}`);
    }
  }
}

/**
 * Create an enclaved express client if the configuration is present
 */
export function createEnclavedExpressClient(coin?: string): EnclavedExpressClient | undefined {
  try {
    return new EnclavedExpressClient(coin);
  } catch (error) {
    const err = error as Error;
    // If URL isn't configured, return undefined instead of throwing
    if (err.message.includes('URL not configured')) {
      debugLogger('Enclaved express URL not configured, returning undefined');
      return undefined;
    }
    throw err;
  }
}
