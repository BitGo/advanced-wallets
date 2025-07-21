import {
  BitGoBase,
  Wallet,
  IRequestTracer,
  EddsaUtils,
  BaseCoin,
  ApiKeyShare,
  TxRequest,
  CommitmentShareRecord,
  EncryptedSignerShareRecord,
  SignShare,
  SignatureShareRecord,
  CustomCommitmentGeneratingFunction,
  CustomRShareGeneratingFunction,
  CustomGShareGeneratingFunction,
} from '@bitgo/sdk-core';
import { SecuredExpressClient, SignMpcCommitmentResponse } from '../clients/securedExpressClient';

/**
 * Creates custom EdDSA signing functions for use with secured express client
 */
export function createEddsaCustomSigningFunctions(
  securedExpressClient: SecuredExpressClient,
  source: 'user' | 'backup',
  commonKeychain: string,
): {
  customCommitmentGenerator: CustomCommitmentGeneratingFunction;
  customRShareGenerator: CustomRShareGeneratingFunction;
  customGShareGenerator: CustomGShareGeneratingFunction;
} {
  // Create state to maintain data between rounds
  let commitmentResponse: SignMpcCommitmentResponse;

  // Create custom signing methods that maintain state
  const customCommitmentGenerator: CustomCommitmentGeneratingFunction = async (params: {
    txRequest: TxRequest;
    bitgoGpgPubKey?: string;
  }) => {
    if (!params.bitgoGpgPubKey) {
      throw new Error('bitgoGpgPubKey is required for commitment share generation');
    }
    const response = await securedExpressClient.signMpcCommitment({
      txRequest: params.txRequest,
      bitgoPublicGpgKey: params.bitgoGpgPubKey,
      source,
      pub: commonKeychain,
    });
    commitmentResponse = response;
    return response;
  };

  const customRShareGenerator: CustomRShareGeneratingFunction = async (params: {
    txRequest: TxRequest;
    encryptedUserToBitgoRShare: EncryptedSignerShareRecord;
  }) => {
    if (!commitmentResponse) {
      throw new Error('Commitment must be completed before R-share generation');
    }
    const response = await securedExpressClient.signMpcRShare({
      txRequest: params.txRequest,
      encryptedUserToBitgoRShare: params.encryptedUserToBitgoRShare,
      encryptedDataKey: commitmentResponse.encryptedDataKey,
      source,
      pub: commonKeychain,
    });
    return { rShare: response.rShare };
  };

  const customGShareGenerator: CustomGShareGeneratingFunction = async (params: {
    txRequest: TxRequest;
    userToBitgoRShare: SignShare;
    bitgoToUserRShare: SignatureShareRecord;
    bitgoToUserCommitment: CommitmentShareRecord;
  }) => {
    if (!commitmentResponse) {
      throw new Error('Commitment must be completed before G-share generation');
    }
    const response = await securedExpressClient.signMpcGShare({
      txRequest: params.txRequest,
      bitgoToUserRShare: params.bitgoToUserRShare,
      userToBitgoRShare: params.userToBitgoRShare,
      bitgoToUserCommitment: params.bitgoToUserCommitment,
      source,
      pub: commonKeychain,
    });
    return response.gShare;
  };

  return {
    customCommitmentGenerator,
    customRShareGenerator,
    customGShareGenerator,
  };
}

export async function handleEddsaSigning(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequest: TxRequest,
  securedExpressClient: SecuredExpressClient,
  commonKeychain: string,
  reqId?: IRequestTracer,
) {
  const eddsaUtils = new EddsaUtils(bitgo, wallet.baseCoin, wallet);
  const { customCommitmentGenerator, customRShareGenerator, customGShareGenerator } =
    createEddsaCustomSigningFunctions(securedExpressClient, 'user', commonKeychain);
  return await eddsaUtils.signEddsaTssUsingExternalSigner(
    txRequest,
    customCommitmentGenerator,
    customRShareGenerator,
    customGShareGenerator,
    reqId,
  );
}

interface OrchestrateEddsaKeyGenParams {
  bitgo: BitGoBase;
  baseCoin: BaseCoin;
  securedExpressClient: SecuredExpressClient;
  enterprise: string;
  walletParams: any;
}

export async function orchestrateEddsaKeyGen({
  bitgo,
  baseCoin,
  securedExpressClient,
  enterprise,
  walletParams,
}: OrchestrateEddsaKeyGenParams) {
  const constants = await bitgo.fetchConstants();
  if (!constants.mpc.bitgoPublicKey) {
    throw new Error('Unable to create MPC keys - bitgoPublicKey is missing in constants');
  }
  // Initialize key generation for user and backup
  const userInitResponse = await securedExpressClient.initMpcKeyGeneration({
    source: 'user',
    bitgoGpgKey: constants.mpc.bitgoPublicKey,
  });
  const backupInitResponse = await securedExpressClient.initMpcKeyGeneration({
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
  const userKeychainPromise = await securedExpressClient.finalizeMpcKeyGeneration({
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
  const backupKeychainPromise = await securedExpressClient.finalizeMpcKeyGeneration({
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
