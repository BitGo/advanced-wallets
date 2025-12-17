import { httpRequest, HttpResponse, httpRoute, optional } from '@api-ts/io-ts-http';
import * as t from 'io-ts';
import { ErrorResponses } from '../../shared/errors';

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
  ...ErrorResponses,
};

/**
 * Advanced Wallets - Accelerate Transaction
 *
 * Send a new transaction to accelerate the targeted unconfirmed transaction either by using Child-Pays-For-Parent (CPFP) or Replace-By-Fee (RBF).
 *
 * Retrieves the private key from KMS using the provided public key, then signs and broadcasts the transaction.
 *
 * Use this endpoint only with advanced wallets. For other wallet types, use [Accelerate Transaction](https://developers.bitgo.com/reference/expresswalletacceleratetx).
 *
 * @tag Advanced Wallets
 * @operationId advancedwallet.accelerate.tx
 */
export const AccelerateRoute = httpRoute({
  method: 'POST',
  path: '/api/v1/{coin}/advancedwallet/{walletId}/accelerate',
  request: httpRequest({
    params: {
      walletId: t.string,
      coin: t.string,
    },
    body: AccelerateRequest,
  }),
  response: AccelerateResponse,
  description: 'Accelerate transaction',
});
