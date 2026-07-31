import {
  BitGoBase,
  EcdsaMPCv2Utils,
  IRequestTracer,
  RequestType,
  Wallet,
  TxRequest,
} from '@bitgo-beta/sdk-core';
import {
  AdvancedWalletManagerClient,
  SignMpcV2Round1Response,
  SignMpcV2Round2Response,
} from '../clients/advancedWalletManagerClient';

/**
 * Creates custom ECDSA MPCv2 signing functions for use with advanced wallet manager client
 */
export function createEcdsaMPCv2CustomSigners(
  awmClient: AdvancedWalletManagerClient,
  source: 'user' | 'backup',
  commonKeychain: string,
) {
  // Create state to maintain data between rounds
  let round1Response: SignMpcV2Round1Response;
  let round2Response: SignMpcV2Round2Response;

  // Create custom signing methods that maintain state
  const customMPCv2Round1Generator = async (params: { txRequest: TxRequest }) => {
    const response = await awmClient.signMPCv2Round1(source, commonKeychain, params);
    round1Response = response;
    return response;
  };

  const customMPCv2Round2Generator = async (params: {
    txRequest: TxRequest;
    encryptedUserGpgPrvKey: string;
    encryptedRound1Session: string;
    bitgoPublicGpgKey: string;
  }) => {
    if (!round1Response) {
      throw new Error('Round 1 must be completed before Round 2');
    }
    const response = await awmClient.signMPCv2Round2(source, commonKeychain, {
      ...params,
      encryptedDataKey: round1Response.encryptedDataKey,
      encryptedRound1Session: round1Response.encryptedRound1Session,
      encryptedUserGpgPrvKey: round1Response.encryptedUserGpgPrvKey,
      bitgoPublicGpgKey: params.bitgoPublicGpgKey,
    });
    round2Response = response;
    return response;
  };

  const customMPCv2Round3Generator = async (params: {
    txRequest: TxRequest;
    encryptedUserGpgPrvKey: string;
    encryptedRound2Session: string;
    bitgoPublicGpgKey: string;
  }) => {
    if (!round2Response) {
      throw new Error('Round 2 must be completed before Round 3');
    }
    return await awmClient.signMPCv2Round3(source, commonKeychain, {
      ...params,
      encryptedDataKey: round1Response.encryptedDataKey,
      encryptedRound2Session: round2Response.encryptedRound2Session,
      encryptedUserGpgPrvKey: round1Response.encryptedUserGpgPrvKey,
      bitgoPublicGpgKey: params.bitgoPublicGpgKey,
    });
  };

  return {
    customMPCv2Round1Generator,
    customMPCv2Round2Generator,
    customMPCv2Round3Generator,
  };
}

export async function signAndSendEcdsaMPCv2FromTxRequest(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequest: TxRequest,
  awmClient: AdvancedWalletManagerClient,
  source: 'user' | 'backup',
  commonKeychain: string,
  reqId: IRequestTracer,
): Promise<TxRequest> {
  const ecdsaMPCv2Utils = new EcdsaMPCv2Utils(bitgo, wallet.baseCoin, wallet);

  // Use the shared custom signing functions
  const { customMPCv2Round1Generator, customMPCv2Round2Generator, customMPCv2Round3Generator } =
    createEcdsaMPCv2CustomSigners(awmClient, source, commonKeychain);

  // This also sends the TxRequest for broadcast
  return await ecdsaMPCv2Utils.signEcdsaMPCv2TssUsingExternalSigner(
    { txRequest, reqId },
    customMPCv2Round1Generator,
    customMPCv2Round2Generator,
    customMPCv2Round3Generator,
    RequestType.tx,
  );
}
