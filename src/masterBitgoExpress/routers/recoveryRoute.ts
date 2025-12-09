import { httpRequest, HttpResponse, httpRoute, optional } from '@api-ts/io-ts-http';
import * as t from 'io-ts';
import { ErrorResponses } from '../../shared/errors';

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

/**
 * Response type for the wallet recovery endpoint. Returns the signed recovery transaction that can be broadcast to the network
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
  ...ErrorResponses,
};

/**
 * Request type for the wallet recovery endpoint.
 * Used to recover funds from both standard multisig and TSS wallets. Recover funds from an advanced wallet by building a transaction with user and backup keys.
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
 * Recover assets (advanced)
 *
 * Recover assets from an advanced wallet with a balance only in the base address. Works for both multisignature and MPC recoveries.
 *
 * To recover assets from an advanced wallet with balances in multiple receive addresses, use [Consolidate and recover assets (advanced)](https://developers.bitgo.com/reference/advancedwalletconsolidaterecovery).
 *
 * Use this endpoint only with advanced wallets. For other wallet types, use the [Wallet Recovery Wizard](https://developers.bitgo.com/docs/wallets-recover#/).
 *
 * @tag Advanced Wallets
 * @operationId advancedwalletrecovery
 */
export const RecoveryRoute = httpRoute({
  method: 'POST',
  path: '/api/v1/{coin}/advancedwallet/recovery',
  request: httpRequest({
    params: {
      coin: t.string,
    },
    body: RecoveryWalletRequest,
  }),
  response: RecoveryWalletResponse,
  description: 'Recover an existing wallet',
});
