import { getTxRequest, KeyIndices, RequestTracer } from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { signAndSendTxRequests } from './transactionRequests';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import coinFactory from '../../shared/coinFactory';

export async function handleSignAndSendTxRequest(
  req: MasterApiSpecRouteRequest<'v1.wallet.txrequest.signAndSend', 'post'>,
) {
  const awmClient = req.awmClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);

  const params = req.decoded;

  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  if (
    wallet.type() !== 'advanced' &&
    !(wallet.type() === 'cold' && wallet.subType() === 'onPrem')
  ) {
    throw new Error('Wallet is not an advanced wallet');
  }

  const keyIdIndex = params.source === 'user' ? KeyIndices.USER : KeyIndices.BACKUP;
  logger.info(`Key ID index: ${keyIdIndex}`);
  logger.info(`Key IDs: ${JSON.stringify(wallet.keyIds(), null, 2)}`);

  // Get the signing keychain
  const signingKeychain = await baseCoin.keychains().get({
    id: wallet.keyIds()[keyIdIndex],
  });

  if (!signingKeychain) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }
  if (params.commonKeychain && signingKeychain.commonKeychain !== params.commonKeychain) {
    throw new Error(
      `Common keychain provided does not match the keychain on wallet for ${params.source}`,
    );
  }

  const txRequest = await getTxRequest(bitgo, wallet.id(), req.params.txRequestId, reqId);
  if (!txRequest) {
    throw new Error(`TxRequest ${req.params.txRequestId} not found`);
  }

  return signAndSendTxRequests(bitgo, wallet, txRequest, awmClient, signingKeychain, reqId);
}
