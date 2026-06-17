import _ from 'lodash';
import { RequestTracer, SendManyOptions, SignedTransaction, Wallet } from '@bitgo-beta/sdk-core';
import { WpSubmitKind } from './multisigSignUtils';

export type WpSubmitArgs = {
  wallet: Wallet;
  signedTx: SignedTransaction;
  wpSubmitParams: Record<string, unknown>;
};
export type WpSubmitHandlerArgs = WpSubmitArgs & { requestTracer: RequestTracer };
export type ComposeFinalTxParams = (
  args: WpSubmitArgs,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export async function submitSignedTxToWp(
  args: WpSubmitHandlerArgs,
  composeFinalTxParams: ComposeFinalTxParams,
): Promise<Record<string, unknown>> {
  const finalTxParams = await composeFinalTxParams(args);
  return (await args.wallet.submitTransaction(finalTxParams, args.requestTracer)) as Record<
    string,
    unknown
  >;
}

export const WP_SUBMIT_HANDLERS: Record<
  WpSubmitKind,
  (args: WpSubmitHandlerArgs) => Promise<Record<string, unknown>>
> = {
  sendMany: (args) =>
    submitSignedTxToWp(args, async ({ wallet, signedTx, wpSubmitParams }) => {
      const extraParams = await wallet.baseCoin.getExtraPrebuildParams({
        ...(wpSubmitParams as SendManyOptions),
        wallet,
      });
      return { ...signedTx, ...extraParams };
    }),

  /**
   * Same field whitelist as SDK's Wallet.accelerateTransaction
   * https://github.com/BitGo/BitGoJS/blob/c0b8a699231f81119a02cced5b2c7fe16fae9757/modules/sdk-core/src/bitgo/wallet/wallet.ts#L298-L301
   */
  accelerate: (args) =>
    submitSignedTxToWp(args, ({ wallet, signedTx, wpSubmitParams }) => ({
      ...signedTx,
      ..._.pick(wpSubmitParams, wallet.prebuildWhitelistedParams()),
    })),
};
