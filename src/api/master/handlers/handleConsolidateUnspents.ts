import { RequestTracer, KeyIndices } from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';

export async function handleConsolidateUnspents(
  req: MasterApiSpecRouteRequest<'v1.wallet.consolidateUnspents', 'post'>,
) {
  const enclavedExpressClient = req.enclavedExpressClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin((req as any).params.coin);
  const params = (req as any).decoded;
  const walletId = (req as any).params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });

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