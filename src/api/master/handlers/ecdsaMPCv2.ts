import {
  BaseCoin,
  BitGoBase,
  EcdsaMPCv2Utils,
  IRequestTracer,
  RequestType,
  SupplementGenerateWalletOptions,
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

interface OrchestrateEcdsaKeyGenParams {
  bitgo: BitGoBase;
  baseCoin: BaseCoin;
  awmClient: AdvancedWalletManagerClient;
  enterprise: string;
  walletParams: SupplementGenerateWalletOptions;
}

export async function orchestrateEcdsaKeyGen({
  bitgo,
  baseCoin,
  awmClient,
  enterprise,
  walletParams,
}: OrchestrateEcdsaKeyGenParams) {
  const constants = await bitgo.fetchConstants();
  if (!constants.mpc.bitgoMPCv2PublicKey) {
    throw new Error('Unable to create MPCv2 keys - bitgoMPCv2PublicKey is missing in constants');
  }
  const ecdsaUtils = new EcdsaMPCv2Utils(bitgo, baseCoin);

  // INITIALIZE ROUND: GENERATE ALL GPG KEYS AND RETRIEVE GPG PUBS FROM ALL PARTIES
  const userInitResponse = await awmClient.initEcdsaMpcV2KeyGenMpcV2({
    source: 'user',
  });
  if (
    !userInitResponse.gpgPub ||
    !userInitResponse.encryptedData ||
    !userInitResponse.encryptedDataKey
  ) {
    throw new Error('Missing required fields in user init response');
  }
  const backupInitResponse = await awmClient.initEcdsaMpcV2KeyGenMpcV2({
    source: 'backup',
  });
  if (
    !backupInitResponse.gpgPub ||
    !backupInitResponse.encryptedData ||
    !backupInitResponse.encryptedDataKey
  ) {
    throw new Error('Missing required fields in backup init response');
  }

  // ROUND 1
  const userRound1Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'user',
    encryptedData: userInitResponse.encryptedData,
    encryptedDataKey: userInitResponse.encryptedDataKey,
    round: 1,
    bitgoGpgPub: constants.mpc.bitgoMPCv2PublicKey,
    counterPartyGpgPub: backupInitResponse.gpgPub,
  });
  const backupRound1Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'backup',
    encryptedData: backupInitResponse.encryptedData,
    encryptedDataKey: backupInitResponse.encryptedDataKey,
    round: 1,
    bitgoGpgPub: constants.mpc.bitgoMPCv2PublicKey,
    counterPartyGpgPub: userInitResponse.gpgPub,
  });
  const [userRound1Response, backupRound1Response] = await Promise.all([
    userRound1Promise,
    backupRound1Promise,
  ]);
  if (!userRound1Response.broadcastMessage) {
    throw new Error('Missing broadcast message in user round 1 response');
  }
  if (!backupRound1Response.broadcastMessage) {
    throw new Error('Missing broadcast message in backup round 1 response');
  }

  // ROUND 1 & 2 BitGo
  const round1And2BitGoResponse = await ecdsaUtils.sendKeyGenerationRound1(
    enterprise,
    userInitResponse.gpgPub,
    backupInitResponse.gpgPub,
    {
      broadcastMessages: [
        userRound1Response.broadcastMessage,
        backupRound1Response.broadcastMessage,
      ],
      p2pMessages: [],
    },
  );
  const { sessionId, bitgoMsg1, bitgoToUserMsg2, bitgoToBackupMsg2 } = round1And2BitGoResponse;

  // ROUND 2
  const userRound2Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'user',
    encryptedData: userRound1Response.encryptedData,
    encryptedDataKey: userRound1Response.encryptedDataKey,
    round: 2,
    broadcastMessages: {
      bitgo: ecdsaUtils.formatBitgoBroadcastMessage(bitgoMsg1),
      counterParty: backupRound1Response.broadcastMessage,
    },
  });
  const backupRound2Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'backup',
    encryptedData: backupRound1Response.encryptedData,
    encryptedDataKey: backupRound1Response.encryptedDataKey,
    round: 2,
    broadcastMessages: {
      bitgo: ecdsaUtils.formatBitgoBroadcastMessage(bitgoMsg1),
      counterParty: userRound1Response.broadcastMessage,
    },
  });
  const [userRound2Response, backupRound2Response] = await Promise.all([
    userRound2Promise,
    backupRound2Promise,
  ]);
  if (!userRound2Response.p2pMessages?.bitgo) {
    throw new Error('Missing BitGo p2p message in user round 2 response');
  }
  if (!backupRound2Response.p2pMessages?.bitgo) {
    throw new Error('Missing BitGo p2p message in backup round 2 response');
  }

  // ROUND 3
  const userRound3Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'user',
    encryptedData: userRound2Response.encryptedData,
    encryptedDataKey: userRound2Response.encryptedDataKey,
    round: 3,
    p2pMessages: {
      bitgo: ecdsaUtils.formatP2PMessage(bitgoToUserMsg2),
      counterParty: backupRound2Response.p2pMessages?.counterParty,
    },
  });
  const backupRound3Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'backup',
    encryptedData: backupRound2Response.encryptedData,
    encryptedDataKey: backupRound2Response.encryptedDataKey,
    round: 3,
    p2pMessages: {
      bitgo: ecdsaUtils.formatP2PMessage(bitgoToBackupMsg2),
      counterParty: userRound2Response.p2pMessages?.counterParty,
    },
  });
  const round3BitGoPromise = ecdsaUtils.sendKeyGenerationRound2(enterprise, sessionId, {
    p2pMessages: [
      userRound2Response.p2pMessages?.bitgo,
      backupRound2Response.p2pMessages?.bitgo,
    ].filter((msg) => msg !== undefined),
    broadcastMessages: [],
  });
  const [userRound3Response, backupRound3Response, round3BitGoResponse] = await Promise.all([
    userRound3Promise,
    backupRound3Promise,
    round3BitGoPromise,
  ]);
  const {
    sessionId: sessionIdRound3,
    bitgoToUserMsg3,
    bitgoToBackupMsg3,
    bitgoCommitment2: bitgoCommitment3,
  } = round3BitGoResponse;
  if (!userRound3Response.p2pMessages?.bitgo) {
    throw new Error('Missing BitGo p2p message in user round 3 response');
  }
  if (!backupRound3Response.p2pMessages?.bitgo) {
    throw new Error('Missing BitGo p2p message in backup round 3 response');
  }
  if (sessionId !== sessionIdRound3) {
    throw new Error('Round 1 and 2 Session IDs do not match');
  }

  // ROUND 4
  const userRound4Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'user',
    encryptedData: userRound3Response.encryptedData,
    encryptedDataKey: userRound3Response.encryptedDataKey,
    round: 4,
    p2pMessages: {
      bitgo: ecdsaUtils.formatP2PMessage(bitgoToUserMsg3, bitgoCommitment3),
      counterParty: backupRound3Response.p2pMessages?.counterParty,
    },
  });
  const backupRound4Promise = awmClient.roundEcdsaMPCv2KeyGen({
    source: 'backup',
    encryptedData: backupRound3Response.encryptedData,
    encryptedDataKey: backupRound3Response.encryptedDataKey,
    round: 4,
    p2pMessages: {
      bitgo: ecdsaUtils.formatP2PMessage(bitgoToBackupMsg3, bitgoCommitment3),
      counterParty: userRound3Response.p2pMessages?.counterParty,
    },
  });
  const [userRound4Response, backupRound4Response] = await Promise.all([
    userRound4Promise,
    backupRound4Promise,
  ]);
  if (!userRound4Response.broadcastMessage) {
    throw new Error('Missing broadcast message in user round 4 response');
  }
  if (!backupRound4Response.broadcastMessage) {
    throw new Error('Missing broadcast message in backup round 4 response');
  }

  // FINALIZE
  const round4BitGoResponse = await ecdsaUtils.sendKeyGenerationRound3(enterprise, sessionId, {
    p2pMessages: [
      userRound3Response.p2pMessages?.bitgo,
      backupRound3Response.p2pMessages?.bitgo,
    ].filter((msg) => msg !== undefined),
    broadcastMessages: [
      userRound4Response.broadcastMessage,
      backupRound4Response.broadcastMessage,
    ].filter((msg) => msg !== undefined),
  });
  const {
    sessionId: sessionIdRound4,
    bitgoMsg4,
    commonKeychain: bitgoCommonKeychain,
  } = round4BitGoResponse;
  const userFinalizePromise = awmClient.finalizeEcdsaMPCv2KeyGen({
    source: 'user',
    encryptedData: userRound4Response.encryptedData,
    encryptedDataKey: userRound4Response.encryptedDataKey,
    broadcastMessages: {
      bitgo: ecdsaUtils.formatBitgoBroadcastMessage(bitgoMsg4),
      counterParty: backupRound4Response.broadcastMessage,
    },
    bitgoCommonKeychain,
  });
  const backupFinalizePromise = awmClient.finalizeEcdsaMPCv2KeyGen({
    source: 'backup',
    encryptedData: backupRound4Response.encryptedData,
    encryptedDataKey: backupRound4Response.encryptedDataKey,
    broadcastMessages: {
      bitgo: ecdsaUtils.formatBitgoBroadcastMessage(bitgoMsg4),
      counterParty: userRound4Response.broadcastMessage,
    },
    bitgoCommonKeychain,
  });
  const [userFinalizeResponse, backupFinalizeResponse] = await Promise.all([
    userFinalizePromise,
    backupFinalizePromise,
  ]);
  if (sessionId !== sessionIdRound4) {
    throw new Error('Round 4 Session IDs do not match');
  }
  if (!userFinalizeResponse.commonKeychain) {
    throw new Error('Missing common keychain in user finalize response');
  }
  if (!backupFinalizeResponse.commonKeychain) {
    throw new Error('Missing common keychain in backup finalize response');
  }
  if (userFinalizeResponse.commonKeychain !== backupFinalizeResponse.commonKeychain) {
    throw new Error('User and backup common keychains do not match');
  }
  if (userFinalizeResponse.commonKeychain !== bitgoCommonKeychain) {
    throw new Error('User and BitGo common keychains do not match');
  }

  // CREATE KEYCHAINS
  const userMpcKey = await baseCoin.keychains().add({
    commonKeychain: userFinalizeResponse.commonKeychain,
    source: 'user',
    type: 'tss',
    isMPCv2: true,
  });
  const backupMpcKey = await baseCoin.keychains().add({
    commonKeychain: backupFinalizeResponse.commonKeychain,
    source: 'backup',
    type: 'tss',
    isMPCv2: true,
  });
  const bitgoKeychain = await baseCoin.keychains().add({
    commonKeychain: bitgoCommonKeychain,
    source: 'bitgo',
    type: 'tss',
    isMPCv2: true,
  });
  walletParams.keys = [userMpcKey.id, backupMpcKey.id, bitgoKeychain.id];
  const keychains = {
    userKeychain: userMpcKey,
    backupKeychain: backupMpcKey,
    bitgoKeychain,
  };
  return { walletParams, keychains };
}
