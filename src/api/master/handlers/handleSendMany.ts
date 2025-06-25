import { RequestTracer, PrebuildTransactionOptions, Memo, KeyIndices } from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';

/**
 * Defines the structure for a single recipient in a send-many transaction.
 * This provides strong typing and autocompletion within the handler.
 */
interface Recipient {
  address: string;
  amount: string | number;
  feeLimit?: string;
  data?: string;
  tokenName?: string;
  tokenData?: any;
}

export async function handleSendMany(req: MasterApiSpecRouteRequest<'v1.wallet.sendMany', 'post'>) {
  const enclavedExpressClient = req.enclavedExpressClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);

  const params = req.decoded;
  params.recipients = params.recipients as Recipient[];

  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  if (wallet.type() !== 'cold' || wallet.subType() !== 'onPrem') {
    throw new Error('Wallet is not an on-prem wallet');
  }

  const keyIdIndex = params.source === 'user' ? KeyIndices.USER : KeyIndices.BACKUP;
  logger.info(`Key ID index: ${keyIdIndex}`);
  logger.info(`Key IDs: ${JSON.stringify(wallet.keyIds(), null, 2)}`);

  // Get the signing keychains
  const signingKeychain = await baseCoin.keychains().get({
    id: wallet.keyIds()[keyIdIndex],
  });

  if (!signingKeychain || !signingKeychain.pub) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }

  if (params.pubkey && params.pubkey !== signingKeychain.pub) {
    throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
  }

  logger.info(`Signing with ${params.source} keychain, pub: ${signingKeychain.pub}`);
  logger.debug(`Signing keychain: ${JSON.stringify(signingKeychain, null, 2)}`);

  try {
    const prebuildParams: PrebuildTransactionOptions = {
      ...params,
      // Convert memo string to Memo object if present
      memo: params.memo ? ({ type: 'text', value: params.memo } as Memo) : undefined,
    };

    // First build the transaction with bitgo
    const txPrebuilt = await wallet.prebuildTransaction({
      ...prebuildParams,
      reqId,
    });

    logger.debug('Tx prebuild: %s', JSON.stringify(txPrebuilt, null, 2));

    // verify transaction prebuild
    try {
      const verified = await baseCoin.verifyTransaction({
        txParams: { ...prebuildParams },
        txPrebuild: txPrebuilt,
        wallet,
        verification: {},
        reqId: reqId,
        walletType: 'onchain',
      });
      if (!verified) {
        throw new Error('Transaction prebuild failed local validation');
      }
      logger.debug('Transaction prebuild verified');
    } catch (e) {
      const err = e as Error;
      logger.error('transaction prebuild failed local validation:', err.message);
      logger.error('transaction prebuild:', JSON.stringify(txPrebuilt, null, 2));
      throw new Error(`Transaction prebuild failed local validation: ${err.message}`);
    }

    logger.debug('Tx prebuild: %s', JSON.stringify(txPrebuilt, null, 2));

    // Then sign it using the enclaved express client
    const signedTx = await enclavedExpressClient.signMultisig({
      txPrebuild: txPrebuilt,
      source: params.source,
      pub: signingKeychain.pub,
    });

    // Get extra prebuild parameters
    const extraParams = await baseCoin.getExtraPrebuildParams({
      ...params,
      wallet,
    });

    // Combine the signed transaction with extra parameters
    const finalTxParams = { ...signedTx, ...extraParams };

    // Submit the half signed transaction
    const result = (await wallet.submitTransaction(finalTxParams, reqId)) as any;
    return result;
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to send many: %s', err.message);
    throw err;
  }
}
