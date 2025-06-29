import {
  AddKeychainOptions,
  EcdsaMPCv2Utils,
  Keychain,
  KeychainsTriplet,
  NotImplementedError,
  promiseProps,
  RequestTracer,
  SupplementGenerateWalletOptions,
  Wallet,
  WalletWithKeychains,
} from '@bitgo-beta/sdk-core';
import _ from 'lodash';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { orchestrateEcdsaKeyGen } from './ecdsaMPCv2';
import { orchestrateEddsaKeyGen } from './eddsa';
import coinFactory from '../../../shared/coinFactory';

/**
 * Request handler for generating a wallet on-premises.
 */
export async function handleGenerateWalletOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const { multisigType } = req.decoded;

  if (multisigType === 'tss') {
    return handleGenerateOnPremMpcWallet(req);
  }

  return handleGenerateOnPremOnChainWallet(req);
}

/**
 * This route is used to generate a multisig wallet when enclaved express is enabled
 */
async function handleGenerateOnPremOnChainWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);

  // The enclavedExpressClient is now available from the request
  const enclavedExpressClient = req.enclavedExpressClient;

  const reqId = new RequestTracer();

  const { label, enterprise } = req.decoded;

  // Create wallet parameters with type assertion to allow 'onprem' subtype
  const walletParams = {
    label: label,
    m: 2,
    n: 3,
    keys: [],
    type: 'cold',
    subType: 'onPrem',
    multisigType: 'onchain',
  } as unknown as SupplementGenerateWalletOptions; // TODO: Add onprem to the SDK subType and remove "unknown" type casting

  if (!_.isUndefined(enterprise)) {
    if (!_.isString(enterprise)) {
      throw new Error('invalid enterprise argument, expecting string');
    }
    walletParams.enterprise = enterprise;
  }

  const userKeychainPromise = async (): Promise<Keychain> => {
    const userKeychain = await enclavedExpressClient.createIndependentKeychain({
      source: 'user',
      coin: req.params.coin,
      type: 'independent',
    });
    const userKeychainParams: AddKeychainOptions = {
      pub: userKeychain.pub,
      keyType: userKeychain.type,
      source: userKeychain.source,
      reqId,
    };

    const newUserKeychain = await baseCoin.keychains().add(userKeychainParams);
    return _.extend({}, newUserKeychain, userKeychain);
  };

  const backupKeychainPromise = async (): Promise<Keychain> => {
    const backupKeychain = await enclavedExpressClient.createIndependentKeychain({
      source: 'backup',
      coin: req.params.coin,
      type: 'independent',
    });
    const backupKeychainParams: AddKeychainOptions = {
      pub: backupKeychain.pub,
      keyType: backupKeychain.type,
      source: backupKeychain.source,
      reqId,
    };

    const newBackupKeychain = await baseCoin.keychains().add(backupKeychainParams);
    return _.extend({}, newBackupKeychain, backupKeychain);
  };

  const { userKeychain, backupKeychain, bitgoKeychain }: KeychainsTriplet = await promiseProps({
    userKeychain: userKeychainPromise(),
    backupKeychain: backupKeychainPromise(),
    bitgoKeychain: baseCoin.keychains().createBitGo({
      enterprise: req.decoded.enterprise,
      keyType: 'independent',
      reqId,
      isDistributedCustody: req.decoded.isDistributedCustody,
    }),
  });

  walletParams.keys = [userKeychain.id, backupKeychain.id, bitgoKeychain.id];

  const keychains = {
    userKeychain,
    backupKeychain,
    bitgoKeychain,
  };

  const finalWalletParams = await baseCoin.supplementGenerateWallet(walletParams, keychains);

  bitgo.setRequestTracer(reqId);
  const newWallet = await bitgo.post(baseCoin.url('/wallet/add')).send(finalWalletParams).result();

  const result: WalletWithKeychains = {
    wallet: new Wallet(bitgo, baseCoin, newWallet),
    userKeychain: userKeychain,
    backupKeychain: backupKeychain,
    bitgoKeychain: bitgoKeychain,
    responseType: 'WalletWithKeychains',
  };

  return { ...result, wallet: result.wallet.toJSON() };
}

/**
 * Generates a MPC wallet
 */
async function handleGenerateOnPremMpcWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.decoded.coin, bitgo);
  const enclavedExpressClient = req.enclavedExpressClient;

  if (!baseCoin.supportsTss()) {
    throw new NotImplementedError(
      `MPC wallet generation is not supported for coin ${req.decoded.coin}`,
    );
  }

  if (!enclavedExpressClient) {
    throw new Error('Enclaved express client is required for MPC wallet generation');
  }

  const reqId = new RequestTracer();
  const { label, enterprise } = req.decoded;

  const walletParams: SupplementGenerateWalletOptions = {
    label: label,
    m: 2,
    n: 3,
    keys: [],
    type: 'cold',
    subType: 'onPrem' as SupplementGenerateWalletOptions['subType'],
    multisigType: 'tss',
  };

  if (!_.isUndefined(enterprise)) {
    if (!_.isString(enterprise)) {
      throw new Error('invalid enterprise argument, expecting string');
    }
    walletParams.enterprise = enterprise;
  }

  const constants = await bitgo.fetchConstants();
  if (!constants.mpc) {
    throw new Error('Unable to create MPC keys - cannot fetch MPC constants');
  }

  // Check if this is an ECDSA wallet
  const isEcdsa = baseCoin.getMPCAlgorithm() === 'ecdsa';

  if (isEcdsa) {
    if (!constants.mpc.bitgoMPCv2PublicKey) {
      throw new Error('Unable to create MPCv2 keys - bitgoMPCv2PublicKey is missing in constants');
    }
    const ecdsaUtils = new EcdsaMPCv2Utils(bitgo, baseCoin);

    // INITIALIZE ROUND: GENERATE ALL GPG KEYS AND RETRIEVE GPG PUBS FROM ALL PARTIES
    // Initialize MPCv2 key generation
    const userInitResponse = await enclavedExpressClient.initMpcV2({
      source: 'user',
    });
    if (
      !userInitResponse.gpgPub ||
      !userInitResponse.encryptedData ||
      !userInitResponse.encryptedDataKey
    ) {
      throw new Error('Missing required fields in user init response');
    }

    const backupInitResponse = await enclavedExpressClient.initMpcV2({
      source: 'backup',
    });
    if (
      !backupInitResponse.gpgPub ||
      !backupInitResponse.encryptedData ||
      !backupInitResponse.encryptedDataKey
    ) {
      throw new Error('Missing required fields in backup init response');
    }

    debugLogger('User MPCv2 key generation initialized:', userInitResponse);
    debugLogger('Backup MPCv2 key generation initialized:', backupInitResponse);

    // IN ROUND n, EACH PARTY TAKES IN MSG (n-1) AND RETUNS MSG n

    // ROUND 1: PASS IN GPG PUBS AND NO MSGS, RETURNS FIRST BROADCAST MSG (MSG 1)
    // bitgo's round 1 acts differently, the method requires the broadcast msgs and return p2p msg for round 2 as well
    const userRound1Promise = enclavedExpressClient.mpcV2Round({
      source: 'user',
      encryptedData: userInitResponse.encryptedData,
      encryptedDataKey: userInitResponse.encryptedDataKey,
      round: 1,
      bitgoGpgPub: constants.mpc.bitgoMPCv2PublicKey,
      counterPartyGpgPub: backupInitResponse.gpgPub,
    });

    const backupRound1Promise = enclavedExpressClient.mpcV2Round({
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

    // this step cannot happen in parallel since it does round 1 and round 2 in one go
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
    // bitgo round 2 messages are generated here alongside the round 1 broadcast messages
    const { sessionId, bitgoMsg1, bitgoToUserMsg2, bitgoToBackupMsg2 } = round1And2BitGoResponse;

    // ROUND 2: PASS IN FIRST BROADCAST MSG, RETURNS FIRST P2P MSG (MSG 2)
    // bitgo's round 2 processing is DONE ALREADY in the previous step
    const userRound2Promise = enclavedExpressClient.mpcV2Round({
      source: 'user',
      encryptedData: userRound1Response.encryptedData,
      encryptedDataKey: userRound1Response.encryptedDataKey,
      round: 2,
      broadcastMessages: {
        bitgo: ecdsaUtils.formatBitgoBroadcastMessage(bitgoMsg1),
        counterParty: backupRound1Response.broadcastMessage,
      },
    });

    const backupRound2Promise = enclavedExpressClient.mpcV2Round({
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

    // ROUND 3: PASS IN FIRST P2P MSG, RETURNS SECOND P2P MSG (MSG 3)
    const userRound3Promise = enclavedExpressClient.mpcV2Round({
      source: 'user',
      encryptedData: userRound2Response.encryptedData,
      encryptedDataKey: userRound2Response.encryptedDataKey,
      round: 3,
      p2pMessages: {
        bitgo: ecdsaUtils.formatP2PMessage(bitgoToUserMsg2),
        counterParty: backupRound2Response.p2pMessages?.counterParty,
      },
    });

    const backupRound3Promise = enclavedExpressClient.mpcV2Round({
      source: 'backup',
      encryptedData: backupRound2Response.encryptedData,
      encryptedDataKey: backupRound2Response.encryptedDataKey,
      round: 3,
      p2pMessages: {
        bitgo: ecdsaUtils.formatP2PMessage(bitgoToBackupMsg2),
        counterParty: userRound2Response.p2pMessages?.counterParty,
      },
    });

    // the method is called round 2 but it actually does round 3
    const round3BitGoPromise = ecdsaUtils.sendKeyGenerationRound2(enterprise, sessionId, {
      p2pMessages: [
        userRound2Response.p2pMessages?.bitgo,
        backupRound2Response.p2pMessages?.bitgo,
      ].filter((msg): msg is NonNullable<typeof msg> => msg !== undefined),
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
      bitgoCommitment2: bitgoCommitment3, // renamed for clarity
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

    // ROUND 4: PASS IN SECOND P2P MSG, RETURNS SECOND BROADCAST MSG (MSG 4)
    // bitgo's round 4 acts differently, it is delayed and will be done in one go with the finalize step
    const userRound4Promise = enclavedExpressClient.mpcV2Round({
      source: 'user',
      encryptedData: userRound3Response.encryptedData,
      encryptedDataKey: userRound3Response.encryptedDataKey,
      round: 4,
      p2pMessages: {
        bitgo: ecdsaUtils.formatP2PMessage(bitgoToUserMsg3, bitgoCommitment3),
        counterParty: backupRound3Response.p2pMessages?.counterParty,
      },
    });

    const backupRound4Promise = enclavedExpressClient.mpcV2Round({
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

    debugLogger('Starting MPCv2 key finalization');

    // FINALIZE ROUND: PASS IN BROADCAST MSG 4, RETURNS COMMON KEYCHAIN
    // bitgo's round 4 is not done yet, so we will have to do it first
    const round4BitGoResponse = await ecdsaUtils.sendKeyGenerationRound3(enterprise, sessionId, {
      p2pMessages: [
        userRound3Response.p2pMessages?.bitgo,
        backupRound3Response.p2pMessages?.bitgo,
      ].filter((msg): msg is NonNullable<typeof msg> => msg !== undefined),
      broadcastMessages: [
        userRound4Response.broadcastMessage,
        backupRound4Response.broadcastMessage,
      ].filter((msg): msg is NonNullable<typeof msg> => msg !== undefined),
    });

    const {
      sessionId: sessionIdRound4,
      bitgoMsg4,
      commonKeychain: bitgoCommonKeychain,
    } = round4BitGoResponse;

    const userFinalizePromise = enclavedExpressClient.mpcV2Finalize({
      source: 'user',
      encryptedData: userRound4Response.encryptedData,
      encryptedDataKey: userRound4Response.encryptedDataKey,
      broadcastMessages: {
        bitgo: ecdsaUtils.formatBitgoBroadcastMessage(bitgoMsg4),
        counterParty: backupRound4Response.broadcastMessage,
      },
      bitgoCommonKeychain,
    });

    const backupFinalizePromise = enclavedExpressClient.mpcV2Finalize({
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

    // Verify common keychains match
    if (userFinalizeResponse.commonKeychain !== backupFinalizeResponse.commonKeychain) {
      throw new Error('User and backup common keychains do not match');
    }
    if (userFinalizeResponse.commonKeychain !== bitgoCommonKeychain) {
      throw new Error('User and BitGo common keychains do not match');
    }

    debugLogger('MPCv2 key generation completed successfully');

    // CLEANUP AND CREATE KEYCHAINS
    // Create keychains
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

    const finalWalletParams = await baseCoin.supplementGenerateWallet(walletParams, keychains);

    bitgo.setRequestTracer(reqId);
    const newWallet = await bitgo
      .post(baseCoin.url('/wallet/add'))
      .send(finalWalletParams)
      .result();

    const result: WalletWithKeychains = {
      wallet: new Wallet(bitgo, baseCoin, newWallet),
      userKeychain: userMpcKey,
      backupKeychain: backupMpcKey,
      bitgoKeychain: bitgoKeychain,
      responseType: 'WalletWithKeychains',
    };

    return { ...result, wallet: result.wallet.toJSON() };
  } else {
    if (!constants.mpc.bitgoPublicKey) {
      throw new Error('Unable to create MPC keys - bitgoPublicKey is missing in constants');
    }
    // Original EdDSA implementation
    // Initialize key generation for user and backup
    const userInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
      source: 'user',
      bitgoGpgKey: constants.mpc.bitgoPublicKey,
    });

    debugLogger('User MPC key generation initialized:', userInitResponse);

    const backupInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
      source: 'backup',
      bitgoGpgKey: constants.mpc.bitgoPublicKey,
      userGpgKey: userInitResponse.bitgoPayload.gpgKey,
    });
    if (!backupInitResponse.counterPartyKeyShare) {
      throw new Error('User key share is missing from initialization response');
    }

    debugLogger('Backup MPC key generation initialized:', backupInitResponse);

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
      enterprise: req.decoded.enterprise,
      userGPGPublicKey: userGPGKey,
      backupGPGPublicKey: backupGPGKey,
      reqId,
    });

    // Finalize user and backup keychains
    const userKeychainPromise = await enclavedExpressClient.finalizeMpcKeyGeneration({
      source: 'user',
      coin: req.params.coin,
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
        keyShares: bitgoKeychain.keyShares as KeyShareType[],
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

    debugLogger('User key finalized', userMpcKey);

    const backupKeychainPromise = await enclavedExpressClient.finalizeMpcKeyGeneration({
      source: 'backup',
      coin: req.params.coin,
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
        keyShares: bitgoKeychain.keyShares as any,
      },
      counterPartyGPGKey: userGPGKey,
      counterPartyKeyShare: userKeychainPromise.counterpartyKeyShare as KeyShareType,
    });

    const backupMpcKey = await baseCoin.keychains().add({
      commonKeychain: backupKeychainPromise.commonKeychain,
      source: 'backup',
      type: 'tss',
    });
    debugLogger('Backup keychain finalized:', backupMpcKey);

    walletParams.keys = [userMpcKey.id, backupMpcKey.id, bitgoKeychain.id];

    const keychains = {
      userKeychain: userMpcKey,
      backupKeychain: backupMpcKey,
      bitgoKeychain,
    };

    const finalWalletParams = await baseCoin.supplementGenerateWallet(walletParams, keychains);

    bitgo.setRequestTracer(reqId);
    const newWallet = await bitgo
      .post(baseCoin.url('/wallet/add'))
      .send(finalWalletParams)
      .result();

    const result: WalletWithKeychains = {
      wallet: new Wallet(bitgo, baseCoin, newWallet),
      userKeychain: userMpcKey,
      backupKeychain: backupMpcKey,
      bitgoKeychain: bitgoKeychain,
      responseType: 'WalletWithKeychains',
    };

    return { ...result, wallet: result.wallet.toJSON() };
  }
}
