import {
  BitGoBase,
  getTxRequest,
  offerUserToBitgoRShare,
  getBitgoToUserRShare,
  sendUserToBitgoGShare,
  Wallet,
  IRequestTracer,
  EddsaUtils,
  BaseCoin,
  ApiKeyShare,
  CustomRShareGeneratingFunction,
  CustomGShareGeneratingFunction,
  CustomCommitmentGeneratingFunction,
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

interface OrchestrateEddsaKeyGenParams {
  bitgo: BitGoBase;
  baseCoin: BaseCoin;
  enclavedExpressClient: EnclavedExpressClient;
  enterprise: string;
  walletParams: any;
}

export async function orchestrateEddsaKeyGen({
  bitgo,
  baseCoin,
  enclavedExpressClient,
  enterprise,
  walletParams,
}: OrchestrateEddsaKeyGenParams) {
  const constants = await bitgo.fetchConstants();
  if (!constants.mpc.bitgoPublicKey) {
    throw new Error('Unable to create MPC keys - bitgoPublicKey is missing in constants');
  }
  // Initialize key generation for user and backup
  const userInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
    source: 'user',
    bitgoGpgKey: constants.mpc.bitgoPublicKey,
  });
  const backupInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
    source: 'backup',
    bitgoGpgKey: constants.mpc.bitgoPublicKey,
    userGpgKey: userInitResponse.bitgoPayload.gpgKey,
  });
  if (!backupInitResponse.counterPartyKeyShare) {
    throw new Error('User key share is missing from initialization response');
  }
  // Extract GPG keys based on payload type
  const userGPGKey =
    userInitResponse.bitgoPayload.from === 'user'
      ? userInitResponse.bitgoPayload.gpgKey
      : undefined;
  const backupGPGKey =
    backupInitResponse.bitgoPayload.from === 'backup'
      ? backupInitResponse.bitgoPayload.gpgKey
      : undefined;
  if (!userGPGKey || !backupGPGKey) {
    throw new Error('Missing required GPG keys from payloads');
  }
  // Create BitGo keychain using the initialization responses
  const bitgoKeychain = await baseCoin.keychains().add({
    keyType: 'tss',
    source: 'bitgo',
    keyShares: [userInitResponse.bitgoPayload, backupInitResponse.bitgoPayload],
    enterprise: enterprise,
    userGPGPublicKey: userGPGKey,
    backupGPGPublicKey: backupGPGKey,
  });
  // Finalize user and backup keychains
  const userKeychainPromise = await enclavedExpressClient.finalizeMpcKeyGeneration({
    source: 'user',
    coin: baseCoin.getFamily(),
    encryptedDataKey: userInitResponse.encryptedDataKey,
    encryptedData: userInitResponse.encryptedData,
    bitGoKeychain: {
      ...bitgoKeychain,
      commonKeychain: bitgoKeychain.commonKeychain ?? '',
      hsmType: bitgoKeychain.hsmType,
      type: 'tss',
      source: 'bitgo',
      verifiedVssProof: true,
      isBitGo: true,
      isTrust: false,
      keyShares: bitgoKeychain.keyShares as ApiKeyShare[],
    },
    counterPartyGPGKey: backupGPGKey,
    counterPartyKeyShare: backupInitResponse.counterPartyKeyShare,
  });
  if (!userKeychainPromise.counterpartyKeyShare) {
    throw new Error('Backup key share is missing from user keychain promise');
  }
  const userMpcKey = await baseCoin.keychains().add({
    commonKeychain: userKeychainPromise.commonKeychain,
    source: 'user',
    type: 'tss',
  });
  const backupKeychainPromise = await enclavedExpressClient.finalizeMpcKeyGeneration({
    source: 'backup',
    coin: baseCoin.getFamily(),
    encryptedDataKey: backupInitResponse.encryptedDataKey,
    encryptedData: backupInitResponse.encryptedData,
    bitGoKeychain: {
      ...bitgoKeychain,
      commonKeychain: bitgoKeychain.commonKeychain ?? '',
      hsmType: bitgoKeychain.hsmType,
      type: 'tss',
      source: 'bitgo',
      verifiedVssProof: true,
      isBitGo: true,
      isTrust: false,
      keyShares: bitgoKeychain.keyShares as ApiKeyShare[],
    },
    counterPartyGPGKey: userGPGKey,
    counterPartyKeyShare: userKeychainPromise.counterpartyKeyShare,
  });
  const backupMpcKey = await baseCoin.keychains().add({
    commonKeychain: backupKeychainPromise.commonKeychain,
    source: 'backup',
    type: 'tss',
  });
  const keychains = {
    userKeychain: userMpcKey,
    backupKeychain: backupMpcKey,
    bitgoKeychain,
  };
  walletParams.keys = [userMpcKey.id, backupMpcKey.id, bitgoKeychain.id];
  return { walletParams, keychains };
}

// Commitment
export function createCustomCommitmentGenerator(
  bitgo: BitGoBase,
  wallet: Wallet,
  enclavedExpressClient: EnclavedExpressClient,
  source: 'user' | 'backup',
  pub: string,
): CustomCommitmentGeneratingFunction {
  return async function customCommitmentGeneratingFunction(params) {
    const eddsaUtils = new EddsaUtils(bitgo, wallet.baseCoin);
    const bitgoGpgKey = await eddsaUtils.getBitgoPublicGpgKey();
    const { txRequest } = params;
    const response = await enclavedExpressClient.signMpcCommitment({
      txRequest,
      bitgoGpgPubKey: bitgoGpgKey.armor(),
      source,
      pub,
    });
    return {
      ...response,
      encryptedUserToBitgoRShare: {
        ...response.encryptedUserToBitgoRShare,
        encryptedDataKey: response.encryptedDataKey,
      },
    };
  };
}

// RShare
export function createCustomRShareGenerator(
  enclavedExpressClient: EnclavedExpressClient,
  source: 'user' | 'backup',
  pub: string,
): CustomRShareGeneratingFunction {
  return async function customRShareGeneratingFunction(params) {
    const { txRequest, encryptedUserToBitgoRShare } = params;
    const encryptedDataKey = (encryptedUserToBitgoRShare as any).encryptedDataKey;
    return await enclavedExpressClient.signMpcRShare({
      txRequest,
      encryptedUserToBitgoRShare,
      encryptedDataKey,
      source,
      pub,
    });
  };
}

// GShare
export function createCustomGShareGenerator(
  enclavedExpressClient: EnclavedExpressClient,
  source: 'user' | 'backup',
  pub: string,
): CustomGShareGeneratingFunction {
  return async function customGShareGeneratingFunction(params) {
    const { txRequest, bitgoToUserRShare, userToBitgoRShare, bitgoToUserCommitment } = params;
    const response = await enclavedExpressClient.signMpcGShare({
      txRequest,
      bitgoToUserRShare,
      userToBitgoRShare,
      bitgoToUserCommitment,
      source,
      pub,
    });
    return response.gShare;
  };
}
