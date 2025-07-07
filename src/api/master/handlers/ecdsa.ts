import {
  BitGoBase,
  getTxRequest,
  Wallet,
  IRequestTracer,
  EcdsaMPCv2Utils,
  RequestType,
  TxRequest,
} from '@bitgo/sdk-core';
import {
  EnclavedExpressClient,
  SignMpcV2Round1Response,
  SignMpcV2Round2Response,
  signMPCv2Round1,
  signMPCv2Round2,
  signMPCv2Round3,
} from '../clients/enclavedExpressClient';

export async function handleEcdsaSigning(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequestId: string,
  enclavedExpressClient: EnclavedExpressClient,
  source: 'user' | 'backup',
  commonKeychain: string,
  reqId: IRequestTracer,
) {
  const ecdsaMPCv2Utils = new EcdsaMPCv2Utils(bitgo, wallet.baseCoin, wallet);
  const txRequest = await getTxRequest(bitgo, wallet.id(), txRequestId, reqId);

  // Create state to maintain data between rounds
  let round1Response: SignMpcV2Round1Response;
  let round2Response: SignMpcV2Round2Response;

  // Create custom signing methods that maintain state
  const customRound1Signer = async (params: { txRequest: TxRequest }) => {
    const response = await signMPCv2Round1(enclavedExpressClient, source, commonKeychain)(params);
    round1Response = response;
    return response;
  };

  const customRound2Signer = async (params: {
    txRequest: TxRequest;
    encryptedUserGpgPrvKey: string;
    encryptedRound1Session: string;
    bitgoPublicGpgKey: string;
  }) => {
    if (!round1Response) {
      throw new Error('Round 1 must be completed before Round 2');
    }
    const response = await signMPCv2Round2(
      enclavedExpressClient,
      source,
      commonKeychain,
    )({
      ...params,
      encryptedDataKey: round1Response.encryptedDataKey,
      encryptedRound1Session: round1Response.encryptedRound1Session,
      encryptedUserGpgPrvKey: round1Response.encryptedUserGpgPrvKey,
      bitgoGpgPubKey: params.bitgoPublicGpgKey,
    });
    round2Response = response;
    return response;
  };

  const customRound3Signer = async (params: {
    txRequest: TxRequest;
    encryptedUserGpgPrvKey: string;
    encryptedRound2Session: string;
    bitgoPublicGpgKey: string;
  }) => {
    if (!round2Response) {
      throw new Error('Round 1 must be completed before Round 3');
    }
    return await signMPCv2Round3(
      enclavedExpressClient,
      source,
      commonKeychain,
    )({
      ...params,
      encryptedDataKey: round1Response.encryptedDataKey,
      encryptedRound2Session: round2Response.encryptedRound2Session,
      encryptedUserGpgPrvKey: round1Response.encryptedUserGpgPrvKey,
      bitgoGpgPubKey: params.bitgoPublicGpgKey,
    });
  };

  // Use the existing signEcdsaMPCv2TssUsingExternalSigner method with our custom signers
  return await ecdsaMPCv2Utils.signEcdsaMPCv2TssUsingExternalSigner(
    { txRequest, reqId },
    customRound1Signer,
    customRound2Signer,
    customRound3Signer,
    RequestType.tx,
  );
}
