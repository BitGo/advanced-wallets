import { RequestTracer, KeyIndices } from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';

export async function handleAccelerate(
  req: MasterApiSpecRouteRequest<'v1.wallet.accelerate', 'post'>,
) {
  const enclavedExpressClient = req.enclavedExpressClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);
  const params = req.decoded;
  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });

  // Log the runtime class name of the wallet object
  logger.info('Wallet runtime class name: %s', wallet?.constructor.name);
  logger.info('Wallet prototype chain: %s', Object.getPrototypeOf(wallet)?.constructor.name);

  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  // Get the signing keychain based on source
  const keyIdIndex = params.source === 'user' ? KeyIndices.USER : KeyIndices.BACKUP;
  const signingKeychain = await baseCoin.keychains().get({
    id: wallet.keyIds()[keyIdIndex],
  });

  if (!signingKeychain || !signingKeychain.pub) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }

  if (params.pubkey && params.pubkey !== signingKeychain.pub) {
    throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
  }

  try {
    // Create custom signing function that delegates to EBE
    const customSigningFunction = async (signParams: any) => {
      const signedTx = await enclavedExpressClient.signMultisig({
        txPrebuild: signParams.txPrebuild,
        source: params.source,
        pub: signingKeychain.pub!,
      });
      return signedTx;
    };

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