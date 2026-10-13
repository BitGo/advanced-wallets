import {
  BitGoBase,
  EddsaMPCv2Utils,
  RequestType,
  Wallet,
  IRequestTracer,
  EddsaUtils,
  TxRequest,
  CommitmentShareRecord,
  EncryptedSignerShareRecord,
  SignShare,
  SignatureShareRecord,
  CustomCommitmentGeneratingFunction,
  CustomEddsaMPCv2SigningRound1GeneratingFunction,
  CustomEddsaMPCv2SigningRound2GeneratingFunction,
  CustomEddsaMPCv2SigningRound3GeneratingFunction,
  CustomRShareGeneratingFunction,
  CustomGShareGeneratingFunction,
  ShareKeyPosition,
} from '@bitgo-beta/sdk-core';
import {
  AdvancedWalletManagerClient,
  SignMpcCommitmentResponse,
  SignMpcV2Round1Response,
  SignMpcV2Round2Response,
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
    const rShare: SignShare = {
      xShare: { i: ShareKeyPosition.USER, y: '', u: '', r: '', R: '' },
      rShares: { [ShareKeyPosition.BITGO]: { ...response.rShare, u: '' } },
    };
    return { rShare };
  };

  const customGShareGenerator: CustomGShareGeneratingFunction = async (params: {
    txRequest: TxRequest;
    bitgoToUserRShare: SignatureShareRecord;
    bitgoToUserCommitment: CommitmentShareRecord;
  }) => {
    if (!commitmentResponse) {
      throw new Error('Commitment must be completed before G-share generation');
    }
    const response = await awmClient.signMpcGShare({
      txRequest: params.txRequest,
      bitgoToUserRShare: params.bitgoToUserRShare,
      encryptedUserToBitgoRShare: commitmentResponse.encryptedUserToBitgoRShare,
      encryptedDataKey: commitmentResponse.encryptedDataKey,
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

/**
 * Creates custom EdDSA MPCv2 signing functions for use with advanced wallet manager client
 */
export function createEddsaMPCv2CustomSigners(
  awmClient: AdvancedWalletManagerClient,
  source: 'user' | 'backup',
  commonKeychain: string,
): {
  customEddsaMPCv2Round1Generator: CustomEddsaMPCv2SigningRound1GeneratingFunction;
  customEddsaMPCv2Round2Generator: CustomEddsaMPCv2SigningRound2GeneratingFunction;
  customEddsaMPCv2Round3Generator: CustomEddsaMPCv2SigningRound3GeneratingFunction;
} {
  // Create state to maintain data between rounds
  let round1Response: SignMpcV2Round1Response;
  let round2Response: SignMpcV2Round2Response;

  // Create custom signing methods that maintain state
  const customEddsaMPCv2Round1Generator: CustomEddsaMPCv2SigningRound1GeneratingFunction =
    async (params: { txRequest: TxRequest }) => {
      const response = await awmClient.signMPCv2Round1(source, commonKeychain, {
        ...params,
        curveType: 'eddsa',
      });
      round1Response = response;
      return response;
    };

  const customEddsaMPCv2Round2Generator: CustomEddsaMPCv2SigningRound2GeneratingFunction =
    async (params: {
      txRequest: TxRequest;
      bitgoPublicGpgKey: string;
      encryptedUserGpgPrvKey: string;
      encryptedRound1Session: string;
    }) => {
      if (!round1Response) {
        throw new Error('Round 1 must be completed before Round 2');
      }
      const response = await awmClient.signMPCv2Round2(source, commonKeychain, {
        ...params,
        curveType: 'eddsa',
        encryptedDataKey: round1Response.encryptedDataKey,
        encryptedRound1Session: round1Response.encryptedRound1Session,
        encryptedUserGpgPrvKey: round1Response.encryptedUserGpgPrvKey,
        bitgoPublicGpgKey: params.bitgoPublicGpgKey,
      });
      round2Response = response;
      return response;
    };

  const customEddsaMPCv2Round3Generator: CustomEddsaMPCv2SigningRound3GeneratingFunction =
    async (params: {
      txRequest: TxRequest;
      bitgoPublicGpgKey: string;
      encryptedUserGpgPrvKey: string;
      encryptedRound2Session: string;
    }) => {
      if (!round2Response) {
        throw new Error('Round 2 must be completed before Round 3');
      }
      return await awmClient.signMPCv2Round3(source, commonKeychain, {
        ...params,
        curveType: 'eddsa',
        encryptedDataKey: round1Response.encryptedDataKey,
        encryptedRound2Session: round2Response.encryptedRound2Session,
        encryptedUserGpgPrvKey: round1Response.encryptedUserGpgPrvKey,
        bitgoPublicGpgKey: params.bitgoPublicGpgKey,
      });
    };

  return {
    customEddsaMPCv2Round1Generator,
    customEddsaMPCv2Round2Generator,
    customEddsaMPCv2Round3Generator,
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

export async function signAndSendEddsaMPCv2FromTxRequest(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequest: TxRequest,
  awmClient: AdvancedWalletManagerClient,
  source: 'user' | 'backup',
  commonKeychain: string,
  reqId: IRequestTracer,
): Promise<TxRequest> {
  const eddsaMPCv2Utils = new EddsaMPCv2Utils(bitgo, wallet.baseCoin, wallet);

  // Use the shared custom signing functions
  const {
    customEddsaMPCv2Round1Generator,
    customEddsaMPCv2Round2Generator,
    customEddsaMPCv2Round3Generator,
  } = createEddsaMPCv2CustomSigners(awmClient, source, commonKeychain);

  // This also sends the TxRequest for broadcast
  return await eddsaMPCv2Utils.signEddsaMPCv2TssUsingExternalSigner(
    { txRequest, reqId },
    customEddsaMPCv2Round1Generator,
    customEddsaMPCv2Round2Generator,
    customEddsaMPCv2Round3Generator,
    RequestType.tx,
  );
}
