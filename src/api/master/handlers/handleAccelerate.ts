import { RequestTracer, KeyIndices } from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { getWalletAndSigningKeychain, makeCustomSigningFunction } from '../../../shared/coinUtils';

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

  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  if (!signingKeychain || !signingKeychain.pub) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }

  if (params.pubkey && params.pubkey !== signingKeychain.pub) {
    throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
  }

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
