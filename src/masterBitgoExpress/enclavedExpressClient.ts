import debug from 'debug';
import https from 'https';
import superagent from 'superagent';
import { MasterExpressConfig } from '../types';
import { SignTransactionRecoveryParams } from '../types/signTxRecovery';

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

//TODO: implement the type
export interface SignTransactionResponse {
  id: string;
}

export class EnclavedExpressClient {
  private readonly baseUrl: string;
  private readonly enclavedExpressCert: string;
  private readonly tlsKey: string;
  private readonly tlsCert: string;
  private readonly allowSelfSigned: boolean;
  private readonly coin?: string;

  constructor(cfg: MasterExpressConfig, coin?: string) {
    if (!cfg.enclavedExpressUrl || !cfg.enclavedExpressCert) {
      throw new Error('enclavedExpressUrl and enclavedExpressCert are required');
    }
    if (!cfg.tlsKey || !cfg.tlsCert) {
      throw new Error('tlsKey and tlsCert are required for mTLS communication');
    }

    this.baseUrl = cfg.enclavedExpressUrl;
    this.enclavedExpressCert = cfg.enclavedExpressCert;
    this.tlsKey = cfg.tlsKey;
    this.tlsCert = cfg.tlsCert;
    this.allowSelfSigned = cfg.allowSelfSigned ?? false;
    this.coin = coin;
    debugLogger('EnclavedExpressClient initialized with URL: %s', this.baseUrl);
  }

  private createHttpsAgent(): https.Agent {
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
      await superagent.get(`${this.baseUrl}/ping`).agent(this.createHttpsAgent()).send();
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
        .agent(this.createHttpsAgent())
        .type('json')
        .send(params);

      return keychain;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to create independent keychain: %s', err.message);
      throw err;
    }
  }
  //TODO: @alex change this one to adjust to your normal signing
  /**
   * Sign a transaction, WIP method
   */
  async signTransactionWIP(
    params: SignTransactionRecoveryParams,
  ): Promise<SignTransactionResponse> {
    if (!this.coin) {
      throw new Error('Coin must be specified to create an independent keychain');
    }
    try {
      debugLogger('Siging tx for coin: %s', this.coin);
      const { body: keychain } = await superagent
        .post(`${this.baseUrl}/api/${this.coin}/sign`)
        .agent(this.createHttpsAgent())
        .type('json')
        .send(params);
      return keychain;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign transaction: %s', err.message);
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
