import { RequestTracer, KeyIndices } from '@bitgo-beta/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { getWalletAndSigningKeychain, makeCustomSigningFunction } from '../handlerUtils';

export async function handleConsolidateUnspents(
  req: MasterApiSpecRouteRequest<'v1.wallet.consolidateunspents', 'post'>,
) {
  const advancedWalletManagerClient = req.advancedWalletManagerClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const params = req.decoded;
  const walletId = req.params.walletId;
  const coin = req.params.coin;

  const { wallet, signingKeychain } = await getWalletAndSigningKeychain({
    bitgo,
    coin,
    walletId,
    params,
    reqId,
    KeyIndices,
  });

  try {
    // Create custom signing function that delegates to AWM
    const customSigningFunction = makeCustomSigningFunction({
      advancedWalletManagerClient,
      source: params.source,
      pub: signingKeychain.pub!,
    });

    // Prepare consolidation parameters
    const consolidationParams = {
      ...params,
      customSigningFunction,
      reqId,
    };

    // Send consolidate unspents
    const result = await wallet.consolidateUnspents(consolidationParams);
    return result;
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to consolidate unspents: %s', err.message);
    throw err;
  }
}
