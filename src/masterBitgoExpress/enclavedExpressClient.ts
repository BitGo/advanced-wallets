import https from 'https';
import debug from 'debug';
import superagent from 'superagent';

import { SignedTransaction, TransactionPrebuild } from '@bitgo/sdk-core';
import { superagentRequestFactory, buildApiClient, ApiClient } from '@api-ts/superagent-wrapper';
import { OfflineVaultTxInfo, RecoveryInfo, UnsignedSweepTxMPCv2 } from '@bitgo/sdk-coin-eth';

import { MasterExpressConfig } from '../types';
import { TlsMode } from '../types';
import { EnclavedApiSpec } from '../enclavedBitgoExpress/routers';
import { PingResponseType, VersionResponseType } from '../types/health';
import { InitEddsaKeyGenerationResponse } from '../enclavedBitgoExpress/routers/enclavedApiSpec';

const debugLogger = debug('bitgo:express:enclavedExpressClient');

export type InitMpcKeyGenerationParams = {
  source: 'user' | 'backup';
  bitgoGpgKey: string;
  userGpgKey?: string;
};

export type FinalizeMpcKeyGenerationParams = {
  source: 'user' | 'backup';
  coin?: string;
  encryptedDataKey: string;
  encryptedData: string;
  bitGoKeychain: {
    id: string;
    source: 'bitgo';
    type: 'tss';
    commonKeychain: string;
    verifiedVssProof: boolean;
    isBitGo?: boolean;
    isTrust?: boolean;
    hsmType?: string;
  };
};

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

  private readonly apiClient: ApiClient<superagent.Request, typeof EnclavedApiSpec>;

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

    // Create a request factory with TLS configuration
    const requestFactory = superagentRequestFactory(superagent, this.baseUrl);

    // Build the type-safe API client
    this.apiClient = buildApiClient(requestFactory, EnclavedApiSpec);

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
      let request = this.apiClient['v1.key.independent'].post({
        coin: this.coin,
        source: params.source,
        seed: params.seed,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      console.log(response);
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
      let request = this.apiClient['v1.multisig.sign'].post({
        coin: this.coin,
        source: params.source,
        pub: params.pub,
        txPrebuild: params.txPrebuild,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);

      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign multisig: %s', err.message);
      throw err;
    }
  }

  /**
   * Ping the enclaved express service to check if it's available
   * @returns {Promise<PingResponseType>}
   */
  async ping(): Promise<PingResponseType> {
    try {
      debugLogger('Pinging enclaved express service at: %s', this.baseUrl);
      let request = this.apiClient['v1.health.ping'].post({});

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);

      debugLogger('Enclaved express service ping successful');
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Enclaved express service ping failed: %s', err.message);
      throw err;
    }
  }

  /**
   * Get the version information from the enclaved express service
   */
  async getVersion(): Promise<VersionResponseType> {
    try {
      debugLogger('Getting version information from enclaved express service');
      let request = this.apiClient['v1.health.version'].get({});

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);

      debugLogger('Successfully retrieved version information');
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to get version information: %s', err.message);
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
      let request = this.apiClient['v1.multisig.recovery'].post({ ...params, coin: this.coin });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }
      debugLogger('Recovering multisig for coin: %s', this.coin);
      const res = await request.decodeExpecting(200);

      return res.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to recover multisig: %s', err.message);
      throw err;
    }
  }

  /**
   * Initialize MPC key generation for a given source and coin
   */
  async initMpcKeyGeneration(
    params: InitMpcKeyGenerationParams,
  ): Promise<InitEddsaKeyGenerationResponse> {
    if (!this.coin) {
      throw new Error('Coin must be specified to initialize MPC key generation');
    }

    try {
      debugLogger('Initializing MPC key generation for coin: %s', this.coin);
      let request = this.apiClient['v1.key.mpc.init'].post({
        coin: this.coin,
        source: params.source,
        bitgoGpgKey: params.bitgoGpgKey,
        userGpgKey: params.userGpgKey,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to initialize MPC key generation: %s', err.message);
      throw err;
    }
  }

  /**
   * Finalize MPC key generation for a given source and coin
   */
  async finalizeMpcKeyGeneration(params: FinalizeMpcKeyGenerationParams): Promise<any> {
    if (!this.coin) {
      throw new Error('Coin must be specified to finalize MPC key generation');
    }

    try {
      debugLogger('Finalizing MPC key generation for coin: %s', this.coin);
      let request = this.apiClient['v1.mpc.finalize'].post({
        coin: this.coin,
        source: params.source,
        encryptedDataKey: params.encryptedDataKey,
        encryptedData: params.encryptedData,
        bitGoKeychain: params.bitGoKeychain,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to finalize MPC key generation: %s', err.message);
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
