import assert from 'assert';
import https from 'https';
import superagent from 'superagent';

import {
  ApiKeyShare,
  CommitmentShareRecord,
  EncryptedSignerShareRecord,
  GShare,
  Keychain,
  MPCSweepTxs,
  MPCTx,
  MPCTxs,
  SignatureShareRecord,
  SignedTransaction,
  SignShare,
  TransactionPrebuild,
  TxRequest,
} from '@bitgo-beta/sdk-core';
import { RecoveryTransaction } from '@bitgo-beta/sdk-coin-trx';
import {
  ApiClient,
  buildApiClient,
  DecodeError,
  superagentRequestFactory,
} from '@api-ts/superagent-wrapper';
import { OfflineVaultTxInfo, RecoveryInfo, UnsignedSweepTxMPCv2 } from '@bitgo-beta/sdk-coin-eth';

import { MasterExpressConfig, TlsMode } from '../../../shared/types';
import { AdvancedWalletManagerApiSpec } from '../../../advancedWalletManager/routers';
import { PingResponseType, VersionResponseType } from '../../../types/health';
import { extractTransactionRequestInfo } from '../../../shared/transactionUtils';
import {
  KeyShareType,
  MpcFinalizeResponseType,
  MpcInitializeResponseType,
  MpcV2FinalizeResponseType,
  MpcV2InitializeResponseType,
  MpcV2RecoveryResponseType,
  MpcV2RoundResponseType,
} from '../../../advancedWalletManager/routers/advancedWalletManagerApiSpec';
import { FormattedOfflineVaultTxInfo } from '@bitgo-beta/abstract-utxo';
import { RecoveryTxRequest } from '@bitgo-beta/sdk-core';
import logger from '../../../logger';

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
    | FormattedOfflineVaultTxInfo
    | MPCTx
    | RecoveryTransaction;
  walletContractAddress: string;
}

interface SignMpcCommitmentParams {
  txRequest: TxRequest;
  bitgoPublicGpgKey: string;
  source: 'user' | 'backup';
  pub: string;
}

export interface SignMpcCommitmentResponse {
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
}

export interface SignMpcV2Round1Response {
  signatureShareRound1: SignatureShareRecord;
  userGpgPubKey: string;
  encryptedRound1Session: string;
  encryptedUserGpgPrvKey: string;
  encryptedDataKey: string;
}

interface SignMpcV2Round2Params {
  txRequest: TxRequest;
  encryptedUserGpgPrvKey: string;
  encryptedRound1Session: string;
  encryptedDataKey: string;
  bitgoPublicGpgKey: string;
}

export interface SignMpcV2Round2Response {
  signatureShareRound2: SignatureShareRecord;
  encryptedRound2Session: string;
}

interface SignMpcV2Round3Params {
  txRequest: TxRequest;
  encryptedUserGpgPrvKey: string;
  encryptedRound2Session: string;
  encryptedDataKey: string;
  bitgoPublicGpgKey: string;
}

export interface SignMpcV2Round3Response {
  signatureShareRound3: SignatureShareRecord;
}

export class AdvancedWalletManagerClient {
  async recoveryMPC(params: {
    unsignedSweepPrebuildTx: MPCTx | MPCSweepTxs | MPCTxs | RecoveryTxRequest;
    userPub: string;
    backupPub: string;
    apiKey: string;
    coinSpecificParams?: Record<string, unknown>;
    walletContractAddress: string;
  }): Promise<SignedTransaction> {
    if (!this.coin) {
      throw new Error('Coin must be specified to recover MPC');
    }

    try {
      logger.info('Recovering MPC for coin: %s', this.coin);

      // Extract the required information from the sweep tx using our utility function
      const tx = params.unsignedSweepPrebuildTx;
      const { signableHex, derivationPath } = extractTransactionRequestInfo(tx);

      const txRequest = {
        unsignedTx: '',
        signableHex,
        derivationPath,
      };

      let request = this.apiClient['v1.mpc.recovery'].post({
        coin: this.coin,
        commonKeychain: params.userPub,
        unsignedSweepPrebuildTx: {
          txRequests: [txRequest],
        },
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to recover MPC: %s', err.message);
      throw err;
    }
  }
  private readonly baseUrl: string;
  private readonly advancedWalletManagerCert: string;
  private readonly tlsKey?: string;
  private readonly tlsCert?: string;
  private readonly allowSelfSigned: boolean;
  private readonly coin?: string;
  private readonly tlsMode: TlsMode;

  private readonly apiClient: ApiClient<superagent.Request, typeof AdvancedWalletManagerApiSpec>;

  constructor(cfg: MasterExpressConfig, coin?: string) {
    if (!cfg.advancedWalletManagerUrl) {
      throw new Error('advancedWalletManagerUrl and advancedWalletManagerCert are required');
    }
    if (
      cfg.tlsMode === TlsMode.MTLS &&
      (!cfg.tlsKey || !cfg.tlsCert || !cfg.advancedWalletManagerUrl)
    ) {
      throw new Error('tlsKey and tlsCert are required for mTLS communication');
    }

    this.baseUrl = cfg.advancedWalletManagerUrl;
    this.advancedWalletManagerCert = cfg.advancedWalletManagerCert;
    this.tlsKey = cfg.tlsKey;
    this.tlsCert = cfg.tlsCert;
    this.allowSelfSigned = cfg.allowSelfSigned ?? false;
    this.coin = coin;
    this.tlsMode = cfg.tlsMode;

    // Create a request factory with TLS configuration
    const requestFactory = superagentRequestFactory(superagent, this.baseUrl);

    // Build the type-safe API client
    this.apiClient = buildApiClient(requestFactory, AdvancedWalletManagerApiSpec);

    logger.info('EnclavedExpressClient initialized with URL: %s', this.baseUrl);
  }

  private createHttpsAgent(): https.Agent {
    if (!this.tlsKey || !this.tlsCert) {
      throw new Error('TLS key and certificate are required for HTTPS agent');
    }
    return new https.Agent({
      rejectUnauthorized: !this.allowSelfSigned,
      ca: this.advancedWalletManagerCert,
      // Use Master Express's own certificate as client cert when connecting to Advanced Wallet Manager
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
      logger.info('Creating independent keychain for coin: %s', this.coin);
      let request = this.apiClient['v1.key.independent'].post({
        coin: this.coin,
        source: params.source,
        seed: params.seed,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      logger.error(
        'Failed to create independent keychain: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
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
      logger.error('Failed to sign multisig: %s', (error as DecodeError).decodedResponse.body);
      throw error;
    }
  }

  /**
   * Ping the advanced wallet manager service to check if it's available
   * @returns {Promise<PingResponseType>}
   */
  async ping(): Promise<PingResponseType> {
    try {
      logger.info('Pinging enclaved express service at: %s', this.baseUrl);
      let request = this.apiClient['v1.health.ping'].post({});

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);

      logger.info('Enclaved express service ping successful');
      return response.body;
    } catch (error) {
      logger.error(
        'Failed to ping enclaved express service: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
    }
  }

  /**
   * Get the version information from the advanced wallet manager service
   */
  async getVersion(): Promise<VersionResponseType> {
    try {
      logger.info('Getting version information from enclaved express service');
      let request = this.apiClient['v1.health.version'].get({});

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);

      logger.info('Successfully retrieved version information');
      return response.body;
    } catch (error) {
      logger.error(
        'Failed to get version information: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
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
      logger.info('Recovering multisig for coin: %s', this.coin);
      const res = await request.decodeExpecting(200);

      return res.body;
    } catch (error) {
      logger.error('Failed to recover multisig: %s', (error as DecodeError).decodedResponse.body);
      throw error;
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
      logger.info('Initializing MPC key generation for coin: %s', this.coin);
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
      logger.error(
        'Failed to initialize MPC key generation: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
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
      logger.info('Finalizing MPC key generation for coin: %s', this.coin);
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
      logger.error(
        'Failed to finalize MPC key generation: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
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
      logger.error(
        'Failed to sign mpc commitment: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
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
      logger.error('Failed to sign mpc r-share: %s', (error as DecodeError).decodedResponse.body);
      throw error;
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
      logger.error('Failed to sign mpc g-share: %s', (error as DecodeError).decodedResponse.body);
      throw error;
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
      logger.info('Initializing MPCv2 key generation for coin: %s', this.coin);
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
      logger.error(
        'Failed to initialize MPCv2 key generation: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
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
      logger.info('Executing MPCv2 round %s for coin: %s', params.round, this.coin);
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
      logger.error(
        'Failed to execute MPCv2 round: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
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
      logger.info('Finalizing MPCv2 key generation for coin: %s', this.coin);
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
      logger.error(
        'Failed to finalize MPCv2 key generation: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
    }
  }

  /**
   * Sign MPCv2 Round 1
   */
  async signMPCv2Round1(
    source: 'user' | 'backup',
    pub: string,
    params: SignMpcV2Round1Params,
  ): Promise<SignMpcV2Round1Response> {
    if (!this['coin']) {
      throw new Error('Coin must be specified to sign an MPCv2 Round 1');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this['coin'],
        shareType: 'mpcv2round1',
        ...params,
        source,
        pub,
      });

      if (this['tlsMode'] === TlsMode.MTLS) {
        request = request.agent(this['createHttpsAgent']());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      logger.error('Failed to sign MPCv2 round 1: %s', (error as DecodeError).decodedResponse.body);
      throw error;
    }
  }

  /**
   * Sign MPCv2 Round 2
   */
  async signMPCv2Round2(
    source: 'user' | 'backup',
    pub: string,
    params: SignMpcV2Round2Params,
  ): Promise<SignMpcV2Round2Response> {
    if (!this['coin']) {
      throw new Error('Coin must be specified to sign an MPCv2 Round 2');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this['coin'],
        shareType: 'mpcv2round2',
        ...params,
        source,
        pub,
      });

      if (this['tlsMode'] === TlsMode.MTLS) {
        request = request.agent(this['createHttpsAgent']());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      logger.error('Failed to sign MPCv2 round 2: %s', (error as DecodeError).decodedResponse.body);
      throw error;
    }
  }

  /**
   * Sign MPCv2 Round 3
   */
  async signMPCv2Round3(
    source: 'user' | 'backup',
    pub: string,
    params: SignMpcV2Round3Params,
  ): Promise<SignMpcV2Round3Response> {
    if (!this['coin']) {
      throw new Error('Coin must be specified to sign an MPCv2 Round 3');
    }

    try {
      let request = this.apiClient['v1.mpc.sign'].post({
        coin: this['coin'],
        shareType: 'mpcv2round3',
        ...params,
        source,
        pub,
      });

      if (this['tlsMode'] === TlsMode.MTLS) {
        request = request.agent(this['createHttpsAgent']());
      }
      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error) {
      logger.error('Failed to sign MPCv2 round 3: %s', (error as DecodeError).decodedResponse.body);
      throw error;
    }
  }

  async recoverEcdsaMpcV2Wallet(params: {
    txHex: string;
    pub: string;
  }): Promise<MpcV2RecoveryResponseType> {
    if (!this.coin) {
      throw new Error('Coin must be specified to finalize MPCv2 key generation');
    }

    try {
      logger.info('Recovering MPCv2 wallet for coin: %s', this.coin);
      let request = this.apiClient['v1.mpcv2.recovery'].post({
        coin: this.coin,
        ...params,
      });

      if (this.tlsMode === TlsMode.MTLS) {
        request = request.agent(this.createHttpsAgent());
      }

      const response = await request.decodeExpecting(200);
      return response.body;
    } catch (error: any) {
      logger.error(
        'Failed to recover MPCv2 wallet: %s',
        (error as DecodeError).decodedResponse.body,
      );
      throw error;
    }
  }
}

/**
 * Create an advanced wallet manager client if the configuration is present
 */
export function createawmClient(
  cfg: MasterExpressConfig,
  coin?: string,
): AdvancedWalletManagerClient | undefined {
  try {
    return new AdvancedWalletManagerClient(cfg, coin);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to create enclaved express client: %s', err.message);
    return undefined;
  }
}
