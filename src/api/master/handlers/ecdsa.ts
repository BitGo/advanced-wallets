import {
  BitGoBase,
  getTxRequest,
  Wallet,
  IRequestTracer,
  EcdsaMPCv2Utils,
  commonTssMethods,
  RequestType,
} from '@bitgo/sdk-core';
import { EnclavedExpressClient } from '../clients/enclavedExpressClient';
import logger from '../../../logger';

export async function handleEcdsaSigning(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequestId: string,
  enclavedExpressClient: EnclavedExpressClient,
  source: 'user' | 'backup',
  commonKeychain: string,
  reqId?: IRequestTracer,
) {
  const ecdsaMPCv2Utils = new EcdsaMPCv2Utils(bitgo, wallet.baseCoin);
  const txRequest = await getTxRequest(bitgo, wallet.id(), txRequestId, reqId);

  // Get BitGo GPG key for MPCv2
  const bitgoGpgKey = await ecdsaMPCv2Utils.getBitgoMpcv2PublicGpgKey();

  // Round 1: Generate user's Round 1 share
  const {
    signatureShareRound1,
    userGpgPubKey,
    encryptedRound1Session,
    encryptedUserGpgPrvKey,
    encryptedDataKey,
  } = await enclavedExpressClient.signMpcV2Round1({
    txRequest,
    bitgoGpgPubKey: bitgoGpgKey.armor(),
    source,
    pub: commonKeychain,
  });

  // Send Round 1 share to BitGo and get updated txRequest
  const round1TxRequest = await commonTssMethods.sendSignatureShareV2(
    bitgo,
    wallet.id(),
    txRequestId,
    [signatureShareRound1],
    RequestType.tx,
    wallet.baseCoin.getMPCAlgorithm(),
    userGpgPubKey,
    undefined,
    wallet.multisigTypeVersion(),
    reqId,
  );

  // Round 2: Generate user's Round 2 share
  const { signatureShareRound2, encryptedRound2Session } =
    await enclavedExpressClient.signMpcV2Round2({
      txRequest: round1TxRequest,
      bitgoGpgPubKey: bitgoGpgKey.armor(),
      encryptedDataKey,
      encryptedUserGpgPrvKey,
      encryptedRound1Session,
      source,
      pub: commonKeychain,
    });

  // Send Round 2 share to BitGo and get updated txRequest
  const round2TxRequest = await commonTssMethods.sendSignatureShareV2(
    bitgo,
    wallet.id(),
    txRequestId,
    [signatureShareRound2],
    RequestType.tx,
    wallet.baseCoin.getMPCAlgorithm(),
    userGpgPubKey,
    undefined,
    wallet.multisigTypeVersion(),
    reqId,
  );

  // Round 3: Generate user's Round 3 share
  const { signatureShareRound3 } = await enclavedExpressClient.signMpcV2Round3({
    txRequest: round2TxRequest,
    bitgoGpgPubKey: bitgoGpgKey.armor(),
    encryptedDataKey,
    encryptedUserGpgPrvKey,
    encryptedRound2Session,
    source,
    pub: commonKeychain,
  });

  // Send Round 3 share to BitGo
  await commonTssMethods.sendSignatureShareV2(
    bitgo,
    wallet.id(),
    txRequestId,
    [signatureShareRound3],
    RequestType.tx,
    wallet.baseCoin.getMPCAlgorithm(),
    userGpgPubKey,
    undefined,
    wallet.multisigTypeVersion(),
    reqId,
  );

  logger.debug('Successfully completed ECDSA MPCv2 signing!');
  return commonTssMethods.sendTxRequest(
    bitgo,
    txRequest.walletId,
    txRequest.txRequestId,
    RequestType.tx,
    reqId,
  );
}
