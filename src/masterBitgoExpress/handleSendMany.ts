import { RequestTracer, PrebuildTransactionOptions, Memo } from '@bitgo/sdk-core';
import { BitGoRequest } from '../types/request';
import { createEnclavedExpressClient } from './enclavedExpressClient';
import logger from '../logger';
import { SendManyRequest } from './routers/masterApiSpec';
import { TypeOf } from 'io-ts';

export async function handleSendMany(req: BitGoRequest) {
  const enclavedExpressClient = createEnclavedExpressClient(req.config, req.params.coin);
  if (!enclavedExpressClient) {
    throw new Error('Please configure enclaved express configs to sign the transactions.');
  }
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);

  const params = req.body as TypeOf<typeof SendManyRequest>;
  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  if (wallet.type() !== 'cold' || wallet.subType() !== 'onPrem') {
    throw new Error('Wallet is not an on-prem wallet');
  }

  // Get the signing keychains
  const signingKeychains = await baseCoin.keychains().getKeysForSigning({
    wallet,
    reqId,
  });

  // Find the user keychain for signing
  const signingKeychain = signingKeychains.find((k) => k.source === params.source);
  if (!signingKeychain) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }

  try {
    const prebuildParams: PrebuildTransactionOptions = {
      ...params,
      // Convert memo string to Memo object if present
      memo: params.memo ? ({ type: 'text', value: params.memo } as Memo) : undefined,
    };

    // First build the transaction
    const txPrebuild = await wallet.prebuildTransaction({
      ...prebuildParams,
      reqId,
    });

    // Then sign it using the enclaved express client
    const signedTx = await enclavedExpressClient.signMultisig({
      txPrebuild,
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
