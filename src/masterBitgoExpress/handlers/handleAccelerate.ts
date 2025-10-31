import { RequestTracer, KeyIndices } from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import { getWalletAndSigningKeychain, makeCustomSigningFunction } from './utils/utils';

export async function handleAccelerate(
  req: MasterApiSpecRouteRequest<'v1.wallet.accelerate', 'post'>,
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

    // Prepare acceleration parameters
    const accelerationParams = {
      ...params,
      customSigningFunction,
      reqId,
      txFormat: 'psbt-lite',
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
