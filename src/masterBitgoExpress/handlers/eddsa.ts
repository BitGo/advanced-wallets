import {
  BitGoBase,
  Wallet,
  IRequestTracer,
  EddsaUtils,
  TxRequest,
  CommitmentShareRecord,
  EncryptedSignerShareRecord,
  SignShare,
  SignatureShareRecord,
  CustomCommitmentGeneratingFunction,
  CustomRShareGeneratingFunction,
  CustomGShareGeneratingFunction,
} from '@bitgo-beta/sdk-core';
import {
  AdvancedWalletManagerClient,
  SignMpcCommitmentResponse,
} from '../clients/advancedWalletManagerClient';

/**
 * Creates custom EdDSA signing functions for use with advanced wallet manager client
 */
export function createEddsaCustomSigningFunctions(
  awmClient: AdvancedWalletManagerClient,
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
    const response = await awmClient.signMpcCommitment({
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
    const response = await awmClient.signMpcRShare({
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
    const response = await awmClient.signMpcGShare({
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
  awmClient: AdvancedWalletManagerClient,
  commonKeychain: string,
  reqId?: IRequestTracer,
) {
  const eddsaUtils = new EddsaUtils(bitgo, wallet.baseCoin, wallet);
  const { customCommitmentGenerator, customRShareGenerator, customGShareGenerator } =
    createEddsaCustomSigningFunctions(awmClient, 'user', commonKeychain);
  return await eddsaUtils.signEddsaTssUsingExternalSigner(
    txRequest,
    customCommitmentGenerator,
    customRShareGenerator,
    customGShareGenerator,
    reqId,
  );
}
