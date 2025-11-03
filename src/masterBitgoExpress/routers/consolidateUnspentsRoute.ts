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
 * Build and send a transaction to consolidate unspents in a wallet.
 * Consolidating unspents is only for UTXO-based assets.
 */
export const ConsolidateUnspentsRoute = httpRoute({
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
});
