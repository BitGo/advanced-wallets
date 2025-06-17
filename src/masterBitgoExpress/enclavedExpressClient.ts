import { OfflineVaultTxInfo, RecoveryInfo, UnsignedSweepTxMPCv2 } from '@bitgo/sdk-coin-eth';
import { SignedTransaction, TransactionPrebuild } from '@bitgo/sdk-core';
import debug from 'debug';
import https from 'https';
import superagent from 'superagent';
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

interface SignMultisigOptions {
  txPrebuild: TransactionPrebuild;
  source: 'user' | 'backup';
  pub: string;
}

interface RecoveryMultisigOptions {
  userPub: string;
  backupPub: string;
  unsignedSweepPrebuildTx: RecoveryInfo | OfflineVaultTxInfo | UnsignedSweepTxMPCv2;
  apiKey: string;
  walletContractAddress: string;
  coinSpecificParams?: {
    bitgoPub?: string;
    ignoreAddressTypes?: string[];
  };
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

  /**
   * Configure the request to use the appropriate TLS mode
   */
  private configureRequest(request: superagent.SuperAgentRequest): superagent.SuperAgentRequest {
    if (this.tlsMode === TlsMode.MTLS) {
      return request.agent(this.createHttpsAgent());
    }
    return request;
  }

  async ping(): Promise<void> {
    try {
      debugLogger('Pinging enclaved express at %s', this.baseUrl);
      await this.configureRequest(superagent.get(`${this.baseUrl}/ping`)).send();
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
      const response = await this.configureRequest(
        superagent.post(`${this.baseUrl}/api/${this.coin}/key/independent`).type('json'),
      ).send(params);

      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to create independent keychain: %s', err.message);
      throw err;
    }
  }

  /**
   * Sign a multisig transaction
   */
  async signMultisig(params: SignMultisigOptions): Promise<SignedTransaction> {
    if (!this.coin) {
      throw new Error('Coin must be specified to sign a multisig');
    }

    try {
      const res = await this.configureRequest(
        superagent.post(`${this.baseUrl}/api/${this.coin}/multisig/sign`).type('json'),
      ).send(params);

      return res.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign multisig: %s', err.message);
      throw err;
    }
  }

  /**
   * Recover a multisig transaction
   */
  async recoveryMultisig(params: RecoveryMultisigOptions): Promise<SignedTransaction> {
    if (!this.coin) {
      throw new Error('Coin must be specified to recover a multisig');
    }

    try {
      const res = await this.configureRequest(
        superagent.post(`${this.baseUrl}/api/${this.coin}/multisig/recovery`).type('json'),
      ).send(params);

      return res.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to recover multisig: %s', err.message);
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
