import {
  BitGoBase,
  getTxRequest,
  offerUserToBitgoRShare,
  getBitgoToUserRShare,
  sendUserToBitgoGShare,
  Wallet,
  IRequestTracer,
  EddsaUtils,
} from '@bitgo/sdk-core';
import { EnclavedExpressClient } from '../clients/enclavedExpressClient';
import { exchangeEddsaCommitments } from '@bitgo/sdk-core/dist/src/bitgo/tss/common';
import logger from '../../../logger';

export async function handleEddsaSigning(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequestId: string,
  enclavedExpressClient: EnclavedExpressClient,
  commonKeychain: string,
  reqId?: IRequestTracer,
) {
  const eddsaUtils = new EddsaUtils(bitgo, wallet.baseCoin);
  const txRequest = await getTxRequest(bitgo, wallet.id(), txRequestId, reqId);

  const { apiVersion } = txRequest;
  const bitgoGpgKey = await eddsaUtils.getBitgoPublicGpgKey();

  const {
    userToBitgoCommitment,
    encryptedSignerShare,
    encryptedUserToBitgoRShare,
    encryptedDataKey,
  } = await enclavedExpressClient.signMpcCommitment({
    txRequest,
    bitgoGpgPubKey: bitgoGpgKey.armor(),
    source: 'user',
    pub: commonKeychain,
  });

  const { commitmentShare: bitgoToUserCommitment } = await exchangeEddsaCommitments(
    bitgo,
    wallet.id(),
    txRequestId,
    userToBitgoCommitment,
    encryptedSignerShare,
    apiVersion,
    reqId,
  );

  const { rShare } = await enclavedExpressClient.signMpcRShare({
    txRequest,
    encryptedUserToBitgoRShare,
    encryptedDataKey,
    source: 'user',
    pub: commonKeychain,
  });

  await offerUserToBitgoRShare(
    bitgo,
    wallet.id(),
    txRequestId,
    rShare,
    encryptedSignerShare.share,
    apiVersion,
    reqId,
  );
  const bitgoToUserRShare = await getBitgoToUserRShare(bitgo, wallet.id(), txRequestId, reqId);
  const gSignShareTransactionParams = {
    txRequest,
    bitgoToUserRShare: bitgoToUserRShare,
    userToBitgoRShare: rShare,
    bitgoToUserCommitment,
  };
  const { gShare } = await enclavedExpressClient.signMpcGShare({
    ...gSignShareTransactionParams,
    source: 'user',
    pub: commonKeychain,
  });

  await sendUserToBitgoGShare(bitgo, wallet.id(), txRequestId, gShare, apiVersion, reqId);
  logger.debug('Successfully completed signing!');
  return await getTxRequest(bitgo, wallet.id(), txRequestId, reqId);
}
