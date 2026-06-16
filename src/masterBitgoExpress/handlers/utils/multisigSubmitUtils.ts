import { RequestTracer, SendManyOptions, SignedTransaction, Wallet } from '@bitgo-beta/sdk-core';

export async function submitSignedMultisigToWp(
  wallet: Wallet,
  signedTx: SignedTransaction,
  params: SendManyOptions,
  reqId: RequestTracer,
): Promise<Record<string, unknown>> {
  const extraParams = await wallet.baseCoin.getExtraPrebuildParams({
    ...params,
    wallet,
  });

  const finalTxParams = { ...signedTx, ...extraParams };

  return (await wallet.submitTransaction(finalTxParams, reqId)) as Record<string, unknown>;
}
