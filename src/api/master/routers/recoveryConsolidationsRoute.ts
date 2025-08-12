import { httpRequest, HttpResponse, httpRoute, optional } from '@api-ts/io-ts-http';
import * as t from 'io-ts';
import { ErrorResponses } from '../../../shared/errors';

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
  ...ErrorResponses,
};

/**
 * Consolidate funds from multiple addresses in a wallet and sign with user & backup keys in a recovery situation.
 * Used for both standard multisig wallets and TSS wallets to consolidate funds from various addresses.
 */
export const RecoveryConsolidationsRoute = httpRoute({
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
});
