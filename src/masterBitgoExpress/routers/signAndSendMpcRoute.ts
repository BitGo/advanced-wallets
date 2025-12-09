import { httpRequest, HttpResponse, httpRoute } from '@api-ts/io-ts-http';
import * as t from 'io-ts';
import { ErrorResponses } from '../../shared/errors';

export const SignMpcRequest = {
  /**
   * The key to use for signing the transaction
   */
  source: t.union([t.literal('user'), t.literal('backup')]),
  /**
   * Common keychain of the wallet during wallet creation
   */
  commonKeychain: t.string,
};

export const SignMpcResponse: HttpResponse = {
  200: t.any,
  ...ErrorResponses,
};

/**
 * Sign and send MPC transaction (advanced)
 *
 * Sign and send a MPC transaction.
 *
 * Use this endpoint only with advanced wallets. For other wallet types, use [Sign MPC transaction](https://developers.bitgo.com/reference/expresswalletsigntxtss).
 *
 * @tag Advanced Wallets
 * @operationId advancedwalletsigntxtss
 */
export const SignAndSendMpcRoute = httpRoute({
  method: 'POST',
  path: '/api/v1/{coin}/advancedwallet/{walletId}/txrequest/{txRequestId}/signAndSend',
  request: httpRequest({
    params: {
      walletId: t.string,
      coin: t.string,
      txRequestId: t.string,
    },
    body: SignMpcRequest,
  }),
  response: SignMpcResponse,
  description: 'Sign a TxRequest and Broadcast it',
});
