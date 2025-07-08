import https from 'https';
import debug from 'debug';
import superagent from 'superagent';

import {
  SignedTransaction,
  TransactionPrebuild,
  TxRequest,
  EncryptedSignerShareRecord,
  SignatureShareRecord,
  SignShare,
  CommitmentShareRecord,
  GShare,
  Keychain,
  ApiKeyShare,
} from '@bitgo/sdk-core';
import { superagentRequestFactory, buildApiClient, ApiClient } from '@api-ts/superagent-wrapper';
import { OfflineVaultTxInfo, RecoveryInfo, UnsignedSweepTxMPCv2 } from '@bitgo/sdk-coin-eth';

import assert from 'assert';
import { MasterExpressConfig, TlsMode } from '../../../shared/types';
import { EnclavedApiSpec } from '../../../enclavedBitgoExpress/routers';
import { PingResponseType, VersionResponseType } from '../../../types/health';
import {
  KeyShareType,
  MpcFinalizeResponseType,
  MpcInitializeResponseType,
  MpcV2FinalizeResponseType,
  MpcV2InitializeResponseType,
  MpcV2RoundResponseType,
} from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { FormattedOfflineVaultTxInfo } from '@bitgo/abstract-utxo';

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
  bitGoKeychain: Keychain & {
    verifiedVssProof: boolean;
    isBitGo?: boolean;
    isTrust?: boolean;
    keyShares: ApiKeyShare[];
  };
  counterPartyGPGKey: string;
  counterPartyKeyShare: KeyShareType;
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
  bitgoPub?: string;
  unsignedSweepPrebuildTx:
    | RecoveryInfo
    | OfflineVaultTxInfo
    | UnsignedSweepTxMPCv2
    | FormattedOfflineVaultTxInfo;
  walletContractAddress: string;
}

interface SignMpcCommitmentParams {
  txRequest: TxRequest;
  bitgoGpgPubKey: string;
  source: 'user' | 'backup';
  pub: string;
}

interface SignMpcCommitmentResponse {
  userToBitgoCommitment: CommitmentShareRecord;
  encryptedSignerShare: EncryptedSignerShareRecord;
  encryptedUserToBitgoRShare: EncryptedSignerShareRecord;
  encryptedDataKey: string;
}

interface SignMpcRShareParams {
  txRequest: TxRequest;
  encryptedUserToBitgoRShare: EncryptedSignerShareRecord;
  encryptedDataKey: string;
  source: 'user' | 'backup';
  pub: string;
}

interface SignMpcRShareResponse {
  rShare: SignShare;
}

interface SignMpcGShareParams {
  txRequest: TxRequest;
  bitgoToUserRShare: SignatureShareRecord;
  userToBitgoRShare: SignShare;
  bitgoToUserCommitment: CommitmentShareRecord;
  source: 'user' | 'backup';
  pub: string;
}

interface SignMpcGShareResponse {
  gShare: GShare;
}

// ECDSA MPCv2 interfaces
interface SignMpcV2Round1Params {
  txRequest: TxRequest;
  bitgoGpgPubKey: string;
  source: 'user' | 'backup';
  pub: string;
}

interface SignMpcV2Round1Response {
  signatureShareRound1: SignatureShareRecord;
  userGpgPubKey: string;
  encryptedRound1Session: string;
  encryptedUserGpgPrvKey: string;
  encryptedDataKey: string;
}

interface SignMpcV2Round2Params {
  txRequest: TxRequest;
  bitgoGpgPubKey: string;
  encryptedDataKey: string;
  encryptedUserGpgPrvKey: string;
  encryptedRound1Session: string;
  source: 'user' | 'backup';
  pub: string;
}

interface SignMpcV2Round2Response {
  signatureShareRound2: SignatureShareRecord;
  encryptedRound2Session: string;
}

interface SignMpcV2Round3Params {
  txRequest: TxRequest;
  bitgoGpgPubKey: string;
  encryptedDataKey: string;
  encryptedUserGpgPrvKey: string;
  encryptedRound2Session: string;
  source: 'user' | 'backup';
  pub: string;
}

interface SignMpcV2Round3Response {
  signatureShareRound3: SignatureShareRecord;
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
  ): Promise<MpcInitializeResponseType> {
    if (!this.coin) {
      throw new Error('Coin must be specified to initialize MPC key generation');
    }

    try {
      debugLogger('Initializing MPC key generation for coin: %s', this.coin);
      let request = this.apiClient['v1.mpc.key.initialize'].post({
        coin: this.coin,
        source: params.source,
        bitgoGpgPub: params.bitgoGpgKey,
        counterPartyGpgPub: params.userGpgKey,
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
  async finalizeMpcKeyGeneration(
    params: FinalizeMpcKeyGenerationParams,
  ): Promise<MpcFinalizeResponseType> {
    if (!this.coin) {
      throw new Error('Coin must be specified to finalize MPC key generation');
    }
    const bitgoKeychain = params.bitGoKeychain;
    assert(
      bitgoKeychain.keyShares && bitgoKeychain.keyShares.length,
      'BitGo keychain must have keyShares property',
    );

    try {
      debugLogger('Finalizing MPC key generation for coin: %s', this.coin);
      let request = this.apiClient['v1.mpc.key.finalize'].post({
        coin: this.coin,
        source: params.source,
        encryptedDataKey: params.encryptedDataKey,
        encryptedData: params.encryptedData,
        bitgoKeyChain: {
          ...bitgoKeychain,
          source: 'bitgo',
          type: 'tss',
          commonKeychain: bitgoKeychain.commonKeychain ?? '',
          keyShares: bitgoKeychain.keyShares,
        },
        counterPartyGpgPub: params.counterPartyGPGKey,
        counterPartyKeyShare: params.counterPartyKeyShare,
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

  async signMpcCommitment(params: SignMpcCommitmentParams): Promise<SignMpcCommitmentResponse> {
    if (!this.coin) {
      throw new Error('Coin must be specified to sign an MPC commitment');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this.coin,
        shareType: 'commitment',
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign mpc commitment: %s', err.message);
      throw err;
    }
  }

  async signMpcRShare(params: SignMpcRShareParams): Promise<SignMpcRShareResponse> {
    if (!this.coin) {
      throw new Error('Coin must be specified to sign an MPC R-share');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this.coin,
        shareType: 'r',
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign mpc r-share: %s', err.message);
      throw err;
    }
  }

  async signMpcGShare(params: SignMpcGShareParams): Promise<SignMpcGShareResponse> {
    if (!this.coin) {
      throw new Error('Coin must be specified to sign an MPC G-share');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this.coin,
        shareType: 'g',
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign mpc g-share: %s', err.message);
      throw err;
    }
  }

  /**
   * Initialize MPCv2 key generation
   */
  async initEcdsaMpcV2KeyGenMpcV2(params: {
    source: 'user' | 'backup';
  }): Promise<MpcV2InitializeResponseType> {
    if (!this.coin) {
      throw new Error('Coin must be specified to initialize MPCv2 key generation');
    }

    try {
      debugLogger('Initializing MPCv2 key generation for coin: %s', this.coin);
      let request = this.apiClient['v1.mpcv2.initialize'].post({
        coin: this.coin,
        source: params.source,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to initialize MPCv2 key generation: %s', err.message);
      throw err;
    }
  }

  /**
   * Execute a round in the MPCv2 protocol
   */
  async roundEcdsaMPCv2KeyGen(params: {
    source: 'user' | 'backup';
    encryptedData: string;
    encryptedDataKey: string;
    round: number;
    bitgoGpgPub?: string;
    counterPartyGpgPub?: string;
    broadcastMessages?: { bitgo: any; counterParty: any };
    p2pMessages?: { bitgo: any; counterParty: any };
  }): Promise<MpcV2RoundResponseType> {
    if (!this.coin) {
      throw new Error('Coin must be specified for MPCv2 round');
    }

    try {
      debugLogger('Executing MPCv2 round %d for coin: %s', params.round, this.coin);
      let request = this.apiClient['v1.mpcv2.round'].post({
        coin: this.coin,
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to execute MPCv2 round: %s', err.message);
      throw err;
    }
  }

  /**
   * Finalize MPCv2 key generation
   */
  async finalizeEcdsaMPCv2KeyGen(params: {
    source: 'user' | 'backup';
    encryptedData: string;
    encryptedDataKey: string;
    broadcastMessages: { bitgo: any; counterParty: any };
    bitgoCommonKeychain: string;
  }): Promise<MpcV2FinalizeResponseType> {
    if (!this.coin) {
      throw new Error('Coin must be specified to finalize MPCv2 key generation');
    }

    try {
      debugLogger('Finalizing MPCv2 key generation for coin: %s', this.coin);
      let request = this.apiClient['v1.mpcv2.finalize'].post({
        coin: this.coin,
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to finalize MPCv2 key generation: %s', err.message);
      throw err;
    }
  }

  async signMpcV2Round1(params: SignMpcV2Round1Params): Promise<SignMpcV2Round1Response> {
    if (!this.coin) {
      throw new Error('Coin must be specified to sign an MPCv2 Round 1');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this.coin,
        shareType: 'mpcv2round1',
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign mpcv2 round 1: %s', err.message);
      throw err;
    }
  }

  async signMpcV2Round2(params: SignMpcV2Round2Params): Promise<SignMpcV2Round2Response> {
    if (!this.coin) {
      throw new Error('Coin must be specified to sign an MPCv2 Round 2');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this.coin,
        shareType: 'mpcv2round2',
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign mpcv2 round 2: %s', err.message);
      throw err;
    }
  }

  async signMpcV2Round3(params: SignMpcV2Round3Params): Promise<SignMpcV2Round3Response> {
    if (!this.coin) {
      throw new Error('Coin must be specified to sign an MPCv2 Round 3');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this.coin,
        shareType: 'mpcv2round3',
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      debugLogger('Failed to sign mpcv2 round 3: %s', err.message);
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
