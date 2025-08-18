import { httpRequest, HttpResponse, httpRoute, optional } from '@api-ts/io-ts-http';
import * as t from 'io-ts';
import { ErrorResponses } from '../../shared/errors';

export const ConsolidateRequest = {
  /**
   * The key to use for signing the transaction
   */
  source: t.union([t.literal('user'), t.literal('backup')]),
  /**
   * Public key of the key used for signing multisig transactions
   */
  pubkey: t.union([t.undefined, t.string]),
  /**
   * Optional: restrict the consolidation to the specified receive addresses. If not provided, will consolidate the
   * funds from all receive addresses up to 500 addresses.
   */
  consolidateAddresses: optional(t.array(t.string)),

  /**
   * For TSS wallets, this is the common keychain of the wallet
   */
  commonKeychain: t.union([t.undefined, t.string]),

  /**
   * The Trasaction Request API version to use for MPC EdDSA Hot Wallets.
   * Defaults based on the wallet type and asset curve.
   */
  apiVersion: t.union([t.undefined, t.literal('full'), t.literal('lite')]),
};

export const ConsolidateResponse: HttpResponse = {
  200: t.any,
  ...ErrorResponses,
};

/**
 * Build, sign, and send a consolidation transaction for an account-based asset all in 1 call.
 * For account-based assets, consolidating the balances in the receive addresses to the base address maximizes the spendable balance of a wallet.
 */
export const ConsolidateRoute = httpRoute({
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
});
