import { httpRequest, HttpResponse, httpRoute, optional } from '@api-ts/io-ts-http';
import * as t from 'io-ts';
import { ErrorResponses } from '../../shared/errors';

export const ConsolidateUnspentsRequest = {
  /**
   * Public key of the key used for signing multisig transactions
   */
  pubkey: t.string,
  /**
   * The key to use for signing the transaction
   */
  source: t.union([t.literal('user'), t.literal('backup')]),
  /**
   * Custom fee rate (in base units) per kilobyte
   */
  feeRate: optional(t.number),
  /**
   * Maximum fee rate (in base units) per kilobyte
   */
  maxFeeRate: optional(t.number),
  /**
   * Maximum fee percentage
   */
  maxFeePercentage: optional(t.number),
  /**
   * Fee transaction confirmation target
   */
  feeTxConfirmTarget: optional(t.number),
  /**
   * Enable bulk processing
   */
  bulk: optional(t.boolean),
  /**
   * Minimum value for unspents
   */
  minValue: optional(t.union([t.string, t.number])),
  /**
   * Maximum value for unspents
   */
  maxValue: optional(t.union([t.string, t.number])),
  /**
   * Minimum block height
   */
  minHeight: optional(t.number),
  /**
   * Minimum confirmations required
   */
  minConfirms: optional(t.number),
  /**
   * Enforce minimum confirmations for change outputs
   */
  enforceMinConfirmsForChange: optional(t.boolean),
  /**
   * Limit the number of unspents to process
   */
  limit: optional(t.number),
  /**
   * Number of unspents to make
   */
  numUnspentsToMake: optional(t.number),
  /**
   * Target address for consolidation
   */
  targetAddress: optional(t.string),
};

export const ConsolidateUnspentsResponse: HttpResponse = {
  200: t.type({
    tx: t.string,
    txid: t.string,
  }),
  ...ErrorResponses,
};

/**
 * Consolidate unspents (advanced)
 *
 * Builds, signs, and sends a transaction to consolidate unspents all in 1 call. Consolidating unspents is only for UTXO-based assets.
 *
 * Use this endpoint only with advanced wallets. For other wallet types, use [Consolidate unspents (simple)](https://developers.bitgo.com/reference/expresswalletconsolidateunspents).
 *
 * @tag Advanced Wallets
 * @operationId advancedwalletconsolidateunspents
 */
export const ConsolidateUnspentsRoute = httpRoute({
  method: 'POST',
  path: '/api/v1/{coin}/advancedwallet/{walletId}/consolidateunspents',
  request: httpRequest({
    params: {
      walletId: t.string,
      coin: t.string,
    },
    body: ConsolidateUnspentsRequest,
  }),
  response: ConsolidateUnspentsResponse,
});
