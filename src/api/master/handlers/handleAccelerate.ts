import { RequestTracer, KeyIndices } from '@bitgo-beta/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { getWalletAndSigningKeychain, makeCustomSigningFunction } from '../handlerUtils';

export async function handleAccelerate(
  req: MasterApiSpecRouteRequest<'v1.wallet.accelerate', 'post'>,
) {
  const enclavedExpressClient = req.enclavedExpressClient;
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
      enclavedExpressClient,
      source: params.source,
      pub: signingKeychain.pub!,
    });

    // Prepare acceleration parameters
    const accelerationParams = {
      ...params,
      customSigningFunction,
      reqId,
    };

    // Accelerate transaction
    const result = await wallet.accelerateTransaction(accelerationParams);

    return result;
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to accelerate transaction: %s', err.message);
    throw err;
  }
}
