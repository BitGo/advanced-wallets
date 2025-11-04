import { RequestTracer, KeyIndices } from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import { getWalletAndSigningKeychain, makeCustomSigningFunction } from './utils/utils';

export async function handleConsolidateUnspents(
  req: MasterApiSpecRouteRequest<'v1.wallet.consolidateunspents', 'post'>,
) {
  const awmClient = req.awmClient;
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
    // Create custom signing function that delegates to EBE
    const customSigningFunction = makeCustomSigningFunction({
      awmClient,
      source: params.source,
      pub: signingKeychain.pub!,
    });

    // Prepare consolidation parameters
    const consolidationParams = {
      ...params,
      customSigningFunction,
      reqId,
      txFormat: 'psbt-lite',
    };

    // Send consolidate unspents
    let result = await wallet.consolidateUnspents(consolidationParams);

    if (Array.isArray(result)) {
      if (result.length === 1) {
        result = result[0];
      } else if (result.length > 1) {
        throw new Error(
          `Expected single consolidation result, but received ${result.length} results`,
        );
      }
    }

    return result;
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to consolidate unspents: %s', err.message);
    throw err;
  }
}
