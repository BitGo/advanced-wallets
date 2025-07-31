import {
  apiSpec,
  httpRequest,
  HttpResponse,
  httpRoute,
  Method as HttpMethod,
  optional,
} from '@api-ts/io-ts-http';
import { Response } from '@api-ts/response';
import {
  createRouter,
  TypedRequestHandler,
  type WrappedRouter,
} from '@api-ts/typed-express-router';
import express from 'express';
import * as t from 'io-ts';
import { MasterExpressConfig } from '../../../shared/types';
import * as utxolib from '@bitgo-beta/utxo-lib';
import { prepareBitGo, responseHandler } from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import { handleGenerateWalletOnPrem } from '../handlers/generateWallet';
import { handleSendMany } from '../handlers/handleSendMany';
import { validateMasterExpressConfig } from '../middleware/middleware';
import { handleRecoveryWalletOnPrem } from '../handlers/recoveryWallet';
import { handleConsolidate } from '../handlers/handleConsolidate';
import { handleAccelerate } from '../handlers/handleAccelerate';
import { handleConsolidateUnspents } from '../handlers/handleConsolidateUnspents';
import { handleSignAndSendTxRequest } from '../handlers/handleSignAndSendTxRequest';
import { handleRecoveryConsolidationsOnPrem } from '../handlers/recoveryConsolidationsWallet';
import {
  BadRequestResponse,
  InternalServerErrorResponse,
  UnprocessableEntityResponse,
  NotFoundResponse,
} from '../../../shared/errors';

export type ScriptType2Of3 = utxolib.bitgo.outputScripts.ScriptType2Of3;

/**
 * Recovery parameter types used by the wallet recovery endpoints
 */
export const RecoveryParamTypes = {
  /**
   * UTXO-specific recovery parameters for Bitcoin & Bitcoin-like cryptocurrencies.
   * Used for recovering funds from standard multisig wallets on UTXO chains.
   * Required when recovering BTC, BCH, LTC, DASH, ZEC, etc.
   */
  utxoRecoveryOptions: t.partial({
    /**
     * Array of address types to ignore during recovery.
     * Useful when you want to exclude specific address types from the recovery process.
     * @example ["p2sh-p2wsh", "p2wsh"]
     */
    ignoreAddressTypes: t.array(t.string),
    /**
     * Derivation path for the user key.
     * Specifies the HD path to derive the correct user key for signing.
     * @example "m/0/0/0/0"
     * @default "m/0"
     */
    userKeyPath: t.string,
    /**
     * Fee rate for the recovery transaction in satoshis per byte.
     * Higher fee rates result in faster confirmations but higher transaction costs.
     * @example 20 // 20 satoshis per byte
     */
    feeRate: t.number,
    /**
     * Number of addresses to scan for funds.
     * Higher values will scan more addresses but take longer to complete.
     * @example 20 // scan 20 addresses
     */
    scan: optional(t.number),
  }),

  /**
   * EVM-specific recovery parameters for Ethereum and EVM-compatible chains.
   * Used for recovering funds from standard multisig wallets on Ethereum and EVM-compatible chains.
   * Required when recovering ETH, MATIC, BSC, AVAX C-Chain, etc.
   */
  ethLikeRecoveryOptions: t.partial({
    /**
     * Gas price in wei for the recovery transaction (for legacy transactions).
     * Higher gas prices result in faster confirmations but higher transaction costs.
     * @example 50000000000 // 50 Gwei
     */
    gasPrice: t.number,

    /**
     * Gas limit for the recovery transaction.
     * Must be enough to cover the contract execution costs.
     * @example 500000
     */
    gasLimit: t.number,

    /**
     * EIP-1559 gas parameters for modern Ethereum transactions.
     * Required for EIP-1559 compatible networks (Ethereum post-London fork).
     */
    eip1559: t.type({
      /**
       * Maximum priority fee per gas in wei (tip for miners/validators).
       * @example 2000000000 // 2 Gwei
       */
      maxPriorityFeePerGas: t.number,

      /**
       * Maximum fee per gas in wei (base fee + priority fee).
       * @example 50000000000 // 50 Gwei
       */
      maxFeePerGas: t.number,
    }),

    /**
     * Replay protection options for the transaction.
     * Required to prevent transaction replay attacks across different chains.
     */
    replayProtectionOptions: t.type({
      /**
       * Chain ID or name.
       * @example 1 // Ethereum Mainnet
       * @example "goerli" // Goerli Testnet
       */
      chain: t.union([t.string, t.number]),

      /**
       * Hardfork name to determine the transaction format.
       * @example "london" // Post-London fork (EIP-1559)
       * @example "istanbul" // Pre-London fork
       * @default "london"
       */
      hardfork: t.string,
    }),

    /**
     * Number of addresses to scan for funds.
     * Higher values will scan more addresses but take longer to complete.
     * @example 20 // scan 20 addresses
     * @default 20
     */
    scan: optional(t.number),
  }),

  /**
   * Solana-specific recovery parameters.
   */
  solanaRecoveryOptions: t.partial({
    /**
     * Durable nonce configuration for transaction durability.
     * Optional but recommended for recovery operations.
     * Refer to https://github.com/BitGo/wallet-recovery-wizard/blob/master/DURABLE_NONCE.md on durable nonce creation.
     */
    durableNonce: optional(
      t.type({
        /**
         * The public key of the durable nonce account.
         */
        publicKey: t.string,
        /**
         * The secret key of the durable nonce account.
         */
        secretKey: t.string,
      }),
    ),
    /**
     * The token contract address for token recovery.
     * Required when recovering tokens.
     */
    tokenContractAddress: t.string,
    /**
     * The close associated token account address.
     * Required for token recovery.
     */
    closeAtaAddress: t.string,
    /**
     * The recovery destination's associated token account address.
     * Required for token recovery.
     */
    recoveryDestinationAtaAddress: t.string,
    /**
     * The program ID for the token.
     * Required for token recovery.
     */
    programId: t.string,
  }),

  // ECDSA ETH-like recovery specific parameters
  ecdsaEthLikeRecoverySpecificParams: t.type({
    walletContractAddress: t.string,
    bitgoDestinationAddress: t.string,
    apiKey: t.string,
  }),

  // ECDSA Cosmos-like recovery specific parameters
  ecdsaCosmosLikeRecoverySpecificParams: t.type({
    rootAddress: t.string,
  }),
};

export type EvmRecoveryOptions = typeof RecoveryParamTypes.ethLikeRecoveryOptions._A;
export type UtxoRecoveryOptions = typeof RecoveryParamTypes.utxoRecoveryOptions._A;
export type SolanaRecoveryOptions = typeof RecoveryParamTypes.solanaRecoveryOptions._A;
export type EcdsaEthLikeRecoverySpecificParams =
  typeof RecoveryParamTypes.ecdsaEthLikeRecoverySpecificParams._A;
export type EcdsaCosmosLikeRecoverySpecificParams =
  typeof RecoveryParamTypes.ecdsaCosmosLikeRecoverySpecificParams._A;

// Combined coin specific parameters
const CoinSpecificParams = t.partial({
  utxoRecoveryOptions: RecoveryParamTypes.utxoRecoveryOptions,
  evmRecoveryOptions: RecoveryParamTypes.ethLikeRecoveryOptions,
  solanaRecoveryOptions: RecoveryParamTypes.solanaRecoveryOptions,
  ecdsaEthLikeRecoverySpecificParams: RecoveryParamTypes.ecdsaEthLikeRecoverySpecificParams,
  ecdsaCosmosLikeRecoverySpecificParams: RecoveryParamTypes.ecdsaCosmosLikeRecoverySpecificParams,
});

export type CoinSpecificParams = t.TypeOf<typeof CoinSpecificParams>;
export type CoinSpecificParamsUnion =
  | EvmRecoveryOptions
  | UtxoRecoveryOptions
  | SolanaRecoveryOptions
  | EcdsaEthLikeRecoverySpecificParams
  | EcdsaCosmosLikeRecoverySpecificParams;

// Middleware functions
export function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return express.json({ limit: '20mb' })(req, res, next);
}

// Response type for /generate endpoint
const GenerateWalletResponse: HttpResponse = {
  // TODO: Get type from public types repo
  200: t.any,
  ...InternalServerErrorResponse,
  ...BadRequestResponse,
};

// Request type for /generate endpoint
const GenerateWalletRequest = {
  label: t.string,
  multisigType: t.union([t.literal('onchain'), t.literal('tss')]),
  enterprise: t.string,
  disableTransactionNotifications: t.union([t.undefined, t.boolean]),
  isDistributedCustody: t.union([t.undefined, t.boolean]),
};

export const SendManyRequest = {
  pubkey: t.union([t.undefined, t.string]),
  // Required for MPC
  type: t.union([
    t.undefined,
    t.literal('transfer'),
    t.literal('fillNonce'),
    t.literal('acceleration'),
    t.literal('accountSet'),
    t.literal('enabletoken'),
    t.literal('stakingLock'),
    t.literal('stakingUnlock'),
    t.literal('transfertoken'),
    t.literal('trustline'),
  ]),
  commonKeychain: t.union([t.undefined, t.string]),
  source: t.union([t.literal('user'), t.literal('backup')]),
  recipients: t.union([t.undefined, t.array(t.any)]),
  numBlocks: t.union([t.undefined, t.number]),
  feeRate: t.union([t.undefined, t.number]),
  feeMultiplier: t.union([t.undefined, t.number]),
  maxFeeRate: t.union([t.undefined, t.number]),
  minConfirms: t.union([t.undefined, t.number]),
  enforceMinConfirmsForChange: t.union([t.undefined, t.boolean]),
  targetWalletUnspents: t.union([t.undefined, t.number]),
  message: t.union([t.undefined, t.string]),
  minValue: t.union([t.undefined, t.union([t.number, t.string])]),
  maxValue: t.union([t.undefined, t.union([t.number, t.string])]),
  sequenceId: t.union([t.undefined, t.string]),
  lastLedgerSequence: t.union([t.undefined, t.number]),
  ledgerSequenceDelta: t.union([t.undefined, t.number]),
  noSplitChange: t.union([t.undefined, t.boolean]),
  unspents: t.union([t.undefined, t.array(t.string)]),
  comment: t.union([t.undefined, t.string]),
  otp: t.union([t.undefined, t.string]),
  changeAddress: t.union([t.undefined, t.string]),
  allowExternalChangeAddress: t.union([t.undefined, t.boolean]),
  instant: t.union([t.undefined, t.boolean]),
  memo: t.union([t.undefined, t.string]),
  transferId: t.union([t.undefined, t.number]),
  eip1559: t.union([t.undefined, t.any]),
  gasLimit: t.union([t.undefined, t.number]),
  custodianTransactionId: t.union([t.undefined, t.string]),
  nonce: t.union([t.undefined, t.string]),
};

export const SendManyResponse: HttpResponse = {
  // TODO: Get type from public types repo / Wallet Platform
  200: t.any,
  ...BadRequestResponse,
  ...NotFoundResponse,
  ...InternalServerErrorResponse,
};

// Request type for /consolidate endpoint
export const ConsolidateRequest = {
  pubkey: t.union([t.undefined, t.string]),
  source: t.union([t.literal('user'), t.literal('backup')]),
  consolidateAddresses: t.union([t.undefined, t.array(t.string)]),
  apiVersion: t.union([t.undefined, t.literal('full'), t.literal('lite')]),
  commonKeychain: t.union([t.undefined, t.string]),
};

// Response type for /consolidate endpoint
const ConsolidateResponse: HttpResponse = {
  200: t.any,
  ...BadRequestResponse, // All failed
  ...InternalServerErrorResponse,
};

/**
 * Request type for the transaction acceleration endpoint.
 * Used to accelerate unconfirmed transactions on UTXO-based blockchains using CPFP or RBF.
 *
 * @endpoint POST /api/{coin}/wallet/{walletId}/accelerate
 * @description Speeds up unconfirmed transactions by creating a child transaction (CPFP) or replacing the original transaction (RBF)
 */
export const AccelerateRequest = {
  /**
   * Public key used for signing the acceleration transaction.
   * @example "xpub661MyMwAqRbcGCNnmzqt3u5KhxmXBHiC78cwAyUMaKJXpFDfHpJwNap6qpG1Kz2SPexKXy3akhPQz7GDYWpHNWkLxRLj6bDxQSf74aTAP9y"
   */
  pubkey: t.string,

  /**
   * The key to use for signing the transaction.
   * @example "user"
   */
  source: t.union([t.literal('user'), t.literal('backup')]),

  /**
   * Transaction IDs to accelerate using Child-Pays-For-Parent (CPFP).
   * CPFP creates a new transaction that spends an output from the original transaction.
   * @example ["abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"]
   */
  cpfpTxIds: optional(t.array(t.string)),

  /**
   * Fee rate in satoshis per byte for the CPFP transaction.
   * Higher fee rates result in faster confirmations but higher transaction costs.
   * @example 50 // 50 satoshis per byte
   */
  cpfpFeeRate: optional(t.number),

  /**
   * Maximum fee in satoshis for the acceleration transaction.
   * Helps prevent overpaying for transaction acceleration.
   * @example 100000 // 0.001 BTC
   */
  maxFee: optional(t.number),

  /**
   * Transaction IDs to accelerate using Replace-By-Fee (RBF).
   * RBF creates a new transaction that replaces the original transaction.
   * The original transaction must have been created with RBF enabled.
   * @example ["abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"]
   */
  rbfTxIds: optional(t.array(t.string)),

  /**
   * Fee multiplier for RBF transactions.
   * The new fee will be the original fee multiplied by this value.
   * @example 1.5 // Increase fee by 50%
   */
  feeMultiplier: optional(t.number),
};

/**
 * Response type for the transaction acceleration endpoint.
 *
 * @endpoint POST /api/{coin}/wallet/{walletId}/accelerate
 * @description Sign an acceleration transaction and send to BitGo to sign and broadcast
 */
const AccelerateResponse: HttpResponse = {
  /**
   * Successful acceleration response.
   * @returns The signed transaction and its ID
   * @example { "txid": "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234", "tx": "01000000000101edd7a5d948a6c79f273ce686a6a8f2e96ed8c2583b5e77b866aa2a1b3426fbed0100000000ffffffff02102700000000000017a914192f23283c2a9e6c5d11562db0eb5d4eb47f460287b9bc2c000000000017a9145c139b242ab3701f321d2399d3a11b028b3b361e870247304402206ac9477fece38d96688c6c3719cb27396c0563ead0567457e7e884b406b6da8802201992d1cfa1b55a67ce8acb482e9957812487d2555f5f54fb0286ecd3095d78e4012103c92564575197c4d6e3d9792280e7548b3ba52a432101c62de2186c4e2fa7fc580000000000" }
   */
  200: t.type({
    /**
     * The transaction ID (hash) of the acceleration transaction.
     * This can be used to track the transaction on a block explorer.
     * @example "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"
     */
    txid: t.string,
    /**
     * The full signed transaction in hexadecimal format.
     * This transaction can be broadcast to the network.
     * @example "01000000000101edd7a5d948a6c79f273ce686a6a8f2e96ed8c2583b5e77b866aa2a1b3426fbed0100000000ffffffff02102700000000000017a914192f23283c2a9e6c5d11562db0eb5d4eb47f460287b9bc2c000000000017a9145c139b242ab3701f321d2399d3a11b028b3b361e870247304402206ac9477fece38d96688c6c3719cb27396c0563ead0567457e7e884b406b6da8802201992d1cfa1b55a67ce8acb482e9957812487d2555f5f54fb0286ecd3095d78e4012103c92564575197c4d6e3d9792280e7548b3ba52a432101c62de2186c4e2fa7fc580000000000"
     */
    tx: t.string,
  }),
  ...InternalServerErrorResponse,
};

/**
 * Response type for the wallet recovery endpoint.
 *
 * @endpoint POST /api/{coin}/wallet/recovery
 * @description Returns the signed recovery transaction that can be broadcast to the network
 */
const RecoveryWalletResponse: HttpResponse = {
  /**
   * Successful recovery response.
   * @returns The signed transaction in hex format
   * @example { "txHex": "01000000000101edd7a5d948a6c79f273ce686a6a8f2e96ed8c2583b5e77b866aa2a1b3426fbed0100000000ffffffff02102700000000000017a914192f23283c2a9e6c5d11562db0eb5d4eb47f460287b9bc2c000000000017a9145c139b242ab3701f321d2399d3a11b028b3b361e870247304402206ac9477fece38d96688c6c3719cb27396c0563ead0567457e7e884b406b6da8802201992d1cfa1b55a67ce8acb482e9957812487d2555f5f54fb0286ecd3095d78e4012103c92564575197c4d6e3d9792280e7548b3ba52a432101c62de2186c4e2fa7fc580000000000" }
   */
  200: t.type({
    /**
     * The full signed transaction in hexadecimal format.
     * This transaction can be broadcast to the network to complete the recovery.
     */
    txHex: t.string,
  }),
  ...UnprocessableEntityResponse,
  ...InternalServerErrorResponse,
};

/**
 * Request type for the wallet recovery endpoint.
 * Used to recover funds from both standard multisig wallets and TSS wallets.
 *
 * @endpoint POST /api/{coin}/wallet/recovery
 * @description Recover funds from a wallet by building a transaction with user and backup keys
 */
const RecoveryWalletRequest = {
  /**
   * Set to true to perform a TSS (Threshold Signature Scheme) recovery.
   * @example true
   */
  isTssRecovery: t.union([t.undefined, t.boolean]),
  /**
   * Parameters specific to TSS recovery.
   * Required when isTssRecovery is true.
   */
  tssRecoveryParams: optional(
    t.type({
      /**
       * The common keychain string used for TSS wallets.
       * Required for TSS recovery.
       * @example "0280ec751d3b165a48811b2cc90f90dcf323f33e8bcaadc0341e1e010adcdcf7005afde80dd286d65b6be947af0424dd1e9f7611f3d20e02a4fc84ad8c8b74c1a5"
       */
      commonKeychain: t.string,
    }),
  ),
  /**
   * Parameters specific to standard multisig recovery.
   * Required when isTssRecovery is false (default).
   */
  multiSigRecoveryParams: optional(
    t.type({
      /**
       * The user's public key.
       * @example "xpub661MyMwAqRbcGCNnmzqt3u5KhxmXBHiC78cwAyUMaKJXpFDfHpJwNap6qpG1Kz2SPexKXy3akhPQz7GDYWpHNWkLxRLj6bDxQSf74aTAP9y"
       */
      userPub: t.string,
      /**
       * The backup public key.
       * @example "xpub661MyMwAqRbcGCNnmzqt3u5KhxmXBHiC78cwAyUMaKJXpFDfHpJwNap6qpG1Kz2SPexKXy3akhPQz7GDYWpHNWkLxRLj6bDxQSf74aTAP9y"
       */
      backupPub: t.string,
      /**
       * The BitGo public key.
       * Required for UTXO coins, optional for others.
       * @example "xpub661MyMwAqRbcGCNnmzqt3u5KhxmXBHiC78cwAyUMaKJXpFDfHpJwNap6qpG1Kz2SPexKXy3akhPQz7GDYWpHNWkLxRLj6bDxQSf74aTAP9y"
       */
      bitgoPub: t.string,
      /**
       * The wallet contract address.
       * Required for ETH-like recoveries.
       * @example "0x1234567890123456789012345678901234567890"
       */
      walletContractAddress: t.string,
    }),
  ),
  /**
   * The address where recovered funds will be sent.
   * Must be a valid address for the coin being recovered.
   * @example "2N8ryDAob6Qn8uCsWvkkQDhyeCQTqybGUFe" // For BTC
   * @example "0x1234567890123456789012345678901234567890" // For ETH
   * @example "9zvKDB8o96QvToQierXtwSfqK9NqaHw7uvmxWsmSrxns" // For SOL
   */
  recoveryDestinationAddress: t.string,
  /**
   * API Key for a block chain explorer.
   * Required for some coins (BTC, ETH) to build a recovery transaction without BitGo.
   */
  apiKey: optional(t.string),
  /**
   * Coin-specific recovery options.
   * Different parameters are required based on the coin family:
   * - For UTXO coins (BTC, etc): provide utxoRecoveryOptions.
   * - For EVM chains (ETH, etc): provide evmRecoveryOptions.
   * - For Solana: provide solanaRecoveryOptions.
   */
  coinSpecificParams: optional(CoinSpecificParams),
};

/**
 * Request type for wallet recovery consolidations endpoint.
 * Used to consolidate and recover funds from multiple addresses in a wallet, via signing with user and backup keys.
 *
 * @endpoint POST /api/{coin}/wallet/recoveryconsolidations
 * @description Consolidates and recovers funds from multiple addresses in a wallet
 */
const RecoveryConsolidationsWalletRequest = {
  /**
   * The user's public key for standard multisig wallets.
   * Required for onchain multisig recovery consolidations.
   * @example "xpub661MyMwAqRbcGCNnmzqt3u5KhxmXBHiC78cwAyUMaKJXpFDfHpJwNap6qpG1Kz2SPexKXy3akhPQz7GDYWpHNWkLxRLj6bDxQSf74aTAP9y"
   */
  userPub: optional(t.string),

  /**
   * The backup public key for standard multisig wallets.
   * Required for onchain multisig recovery consolidations.
   * @example "xpub661MyMwAqRbcGCNnmzqt3u5KhxmXBHiC78cwAyUMaKJXpFDfHpJwNap6qpG1Kz2SPexKXy3akhPQz7GDYWpHNWkLxRLj6bDxQSf74aTAP9y"
   */
  backupPub: optional(t.string),

  /**
   * The BitGo public key for standard multisig wallets.
   * Required for onchain UTXO multisig recovery consolidations.
   * @example "xpub661MyMwAqRbcGCNnmzqt3u5KhxmXBHiC78cwAyUMaKJXpFDfHpJwNap6qpG1Kz2SPexKXy3akhPQz7GDYWpHNWkLxRLj6bDxQSf74aTAP9y"
   */
  bitgoPub: optional(t.string),

  /**
   * The type of wallet to recover
   * - onchain: Traditional multisig wallets.
   * - tss: Threshold Signature Scheme wallets.
   * @example "onchain"
   */
  multisigType: t.union([t.literal('onchain'), t.literal('tss')]),

  /**
   * The common keychain for TSS wallets.
   * Required when multisigType is 'tss'.
   * @example "0280ec751d3b165a48811b2cc90f90dcf323f33e8bcaadc0341e1e010adcdcf7005afde80dd286d65b6be947af0424dd1e9f7611f3d20e02a4fc84ad8c8b74c1a5"
   */
  commonKeychain: optional(t.string),

  /**
   * The token contract address for token recovery (e.g., ERC20 tokens on Ethereum or SPL tokens on Solana).
   * Required when recovering specific tokens instead of the native coin.
   * @example "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // USDC on Ethereum
   * @example "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC on Solana
   */
  tokenContractAddress: optional(t.string),

  /**
   * The starting index to scan for addresses to consolidate.
   * Useful for limiting the scan range for better performance.
   * @example 0
   */
  startingScanIndex: optional(t.number),

  /**
   * The ending index to scan for addresses to consolidate.
   * Useful for limiting the scan range for better performance.
   * @example 100
   * @default 20
   */
  endingScanIndex: optional(t.number),

  /**
   * API key for blockchain explorer services.
   * Required for some coins to build recovery transactions.
   * @example "v2x8d5e46cf15a7b9b7xc60685d4f56xd8bd5f5cdcef3c1e9d4399c955d587179b"
   */
  apiKey: optional(t.string),

  /**
   * Durable nonces configuration for Solana transactions.
   * Provides transaction durability for Solana recovery operations.
   * Refer to https://github.com/BitGo/wallet-recovery-wizard/blob/master/DURABLE_NONCE.md on durable nonce creation.
   */
  durableNonces: optional(
    t.type({
      /**
       * The secret key of the durable nonce account.
       * @example "3XNrU5JSPs2VnZCLnWK8GDzB6Pqoy3tYNMJJVesKBXnGqRxwdXDg2QKgv7E9a6QbAiKnLHSxysKWgXDKNdfXZCQM"
       */
      secretKey: t.string,

      /**
       * Array of public keys associated with the durable nonce.
       * @example ["BurablNonc1234567890123456789012345678901", "BurablNonc1234567890123456789012345678902"]
       */
      publicKeys: t.array(t.string),
    }),
  ),
};

/**
 * Response type for the wallet recovery consolidations endpoint
 *
 * @endpoint POST /api/{coin}/wallet/recoveryconsolidations
 * @description Returns the signed consolidation transactions
 */
const RecoveryConsolidationsWalletResponse: HttpResponse = {
  /**
   * Successful consolidation response.
   * Returns an array of consolidation transactions and recovery details.
   * The exact structure depends on the coin and recovery type.
   */
  200: t.any, // Complex response structure varies by coin and recovery type
  ...InternalServerErrorResponse,
};

export const ConsolidateUnspentsRequest = {
  pubkey: t.string,
  source: t.union([t.literal('user'), t.literal('backup')]),
  feeRate: t.union([t.undefined, t.number]),
  maxFeeRate: t.union([t.undefined, t.number]),
  maxFeePercentage: t.union([t.undefined, t.number]),
  feeTxConfirmTarget: t.union([t.undefined, t.number]),
  bulk: t.union([t.undefined, t.boolean]),
  minValue: t.union([t.undefined, t.union([t.string, t.number])]),
  maxValue: t.union([t.undefined, t.union([t.string, t.number])]),
  minHeight: t.union([t.undefined, t.number]),
  minConfirms: t.union([t.undefined, t.number]),
  enforceMinConfirmsForChange: t.union([t.undefined, t.boolean]),
  limit: t.union([t.undefined, t.number]),
  numUnspentsToMake: t.union([t.undefined, t.number]),
  targetAddress: t.union([t.undefined, t.string]),
  txFormat: t.union([t.undefined, t.literal('legacy'), t.literal('psbt'), t.literal('psbt-lite')]),
};

const ConsolidateUnspentsResponse: HttpResponse = {
  200: t.type({
    tx: t.string,
    txid: t.string,
  }),
  ...BadRequestResponse,
  ...InternalServerErrorResponse,
};

const SignMpcRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  commonKeychain: t.union([t.undefined, t.string]),
};

const SignMpcResponse: HttpResponse = {
  200: t.any,
  ...InternalServerErrorResponse,
};

// API Specification
export const MasterApiSpec = apiSpec({
  'v1.wallet.generate': {
    post: httpRoute({
      method: 'POST' as const,
      path: '/api/{coin}/wallet/generate',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: GenerateWalletRequest,
      }),
      response: GenerateWalletResponse,
      description: 'Generate a new wallet',
    }),
  },
  'v1.wallet.sendMany': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/sendMany',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: SendManyRequest,
      }),
      response: SendManyResponse,
      description: 'Send many transactions',
    }),
  },
  'v1.wallet.txrequest.signAndSend': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/txrequest/{txRequestId}/signAndSend',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
          txRequestId: t.string,
        },
        body: SignMpcRequest,
      }),
      response: SignMpcResponse,
      description: 'Sign MPC with TxRequest',
    }),
  },
  'v1.wallet.recovery': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/recovery',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: RecoveryWalletRequest,
      }),
      response: RecoveryWalletResponse,
      description: 'Recover an existing wallet',
    }),
  },
  'v1.wallet.recoveryConsolidations': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/recoveryconsolidations',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: RecoveryConsolidationsWalletRequest,
      }),
      response: RecoveryConsolidationsWalletResponse,
      description: 'Consolidate and recover an existing wallet',
    }),
  },
  'v1.wallet.consolidate': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/consolidate',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: ConsolidateRequest,
      }),
      response: ConsolidateResponse,
      description: 'Consolidate addresses',
    }),
  },
  'v1.wallet.accelerate': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/accelerate',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: AccelerateRequest,
      }),
      response: AccelerateResponse,
      description: 'Accelerate transaction',
    }),
  },
  'v1.wallet.consolidateunspents': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/consolidateunspents',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: ConsolidateUnspentsRequest,
      }),
      response: ConsolidateUnspentsResponse,
      description: 'Consolidate unspents',
    }),
  },
});

export type MasterApiSpec = typeof MasterApiSpec;

export type MasterApiSpecRouteHandler<
  ApiName extends keyof MasterApiSpec,
  Method extends keyof MasterApiSpec[ApiName] & HttpMethod,
> = TypedRequestHandler<MasterApiSpec, ApiName, Method>;

export type MasterApiSpecRouteRequest<
  ApiName extends keyof MasterApiSpec,
  Method extends keyof MasterApiSpec[ApiName] & HttpMethod,
> = BitGoRequest & Parameters<MasterApiSpecRouteHandler<ApiName, Method>>[0];

export type GenericMasterApiSpecRouteRequest = MasterApiSpecRouteRequest<any, any>;

// Create router with handlers
export function createMasterApiRouter(
  cfg: MasterExpressConfig,
): WrappedRouter<typeof MasterApiSpec> {
  const router = createRouter(MasterApiSpec);

  // Add middleware to all routes
  router.use(parseBody);
  router.use(prepareBitGo(cfg));
  router.use(validateMasterExpressConfig);

  // Generate wallet endpoint handler
  router.post('v1.wallet.generate', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleGenerateWalletOnPrem(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.sendMany', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleSendMany(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.recovery', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleRecoveryWalletOnPrem(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.consolidate', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleConsolidate(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.recoveryConsolidations', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleRecoveryConsolidationsOnPrem(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.accelerate', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleAccelerate(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.consolidateunspents', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleConsolidateUnspents(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.txrequest.signAndSend', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleSignAndSendTxRequest(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
