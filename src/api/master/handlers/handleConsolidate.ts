import { RequestTracer, KeyIndices } from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';

export async function handleConsolidate(
  req: MasterApiSpecRouteRequest<'v1.wallet.consolidate', 'post'>,
) {
  const enclavedExpressClient = req.enclavedExpressClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);
  const params = req.decoded;
  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });

  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  // Check if the coin supports account consolidations
  if (!baseCoin.allowsAccountConsolidations()) {
    throw new Error('Invalid coin selected - account consolidations not supported');
  }

  // Validate consolidateAddresses parameter
  if (params.consolidateAddresses && !Array.isArray(params.consolidateAddresses)) {
    throw new Error('consolidateAddresses must be an array of addresses');
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

    // Prepare consolidation parameters
    const consolidationParams = {
      ...params,
      customSigningFunction,
      reqId,
    };

    // Send account consolidations
    const result = await wallet.sendAccountConsolidations(consolidationParams);

    // Handle failures
    if (result.failure && result.failure.length > 0) {
      logger.debug('Consolidation result: %s', JSON.stringify(result, null, 2));
      let msg = '';
      let status = 202;

      if (result.success && result.success.length > 0) {
        // Some succeeded, some failed
        msg = `Consolidations failed: ${result.failure.length} and succeeded: ${result.success.length}`;
      } else {
        // All failed
        status = 400;
        msg = 'All consolidations failed';
      }

      const error = new Error(msg);
      (error as any).status = status;
      (error as any).result = result;
      throw error;
    }

    return result;
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to consolidate account: %s', err.message);
    throw err;
  }
}
