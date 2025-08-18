import { DklsComms, DklsDkg, DklsTypes } from '@bitgo-beta/sdk-lib-mpc';
import {
  AwmApiSpecRouteRequest,
  MpcV2RoundResponseType,
  MpcV2RoundState,
} from '../routers/advancedWalletManagerApiSpec';
import { MPCv2PartiesEnum } from '@bitgo-beta/sdk-core/dist/src/bitgo/utils/tss/ecdsa';
import { KmsClient } from '../kmsClient/kmsClient';
import logger from '../../shared/logger';
import { BadRequestError, ValidationError } from '../../shared/errors';

export async function ecdsaMPCv2Round(
  req: AwmApiSpecRouteRequest<'v1.mpcv2.round', 'post'>,
): Promise<MpcV2RoundResponseType> {
  const { source, encryptedData, encryptedDataKey, round, broadcastMessages, p2pMessages } =
    req.decoded;
  const bitgoGpgPubInput = req.body.bitgoGpgPub;
  const counterPartyGpgPubInput = req.body.counterPartyGpgPub;

  // setup clients
  const kms = new KmsClient(req.config);

  // sanity checks
  if (round < 1 || round > 4) {
    throw new BadRequestError('Round must be between 1 and 4');
  }

  if (!broadcastMessages && !p2pMessages && round > 1) {
    throw new BadRequestError('At least one of broadcastMessages or p2pMessages must be provided');
  }

  if (broadcastMessages && (!broadcastMessages.bitgo || !broadcastMessages.counterParty)) {
    throw new BadRequestError('broadcastMessages did not contain all required messages');
  }

  if (p2pMessages && (!p2pMessages.bitgo || !p2pMessages.counterParty)) {
    throw new BadRequestError('p2pMessages did not contain all required messages');
  }

  // fetch previous state of execution
  const { plaintextKey } = await kms.decryptDataKey({ encryptedKey: encryptedDataKey });
  const state: MpcV2RoundState = JSON.parse(
    req.bitgo.decrypt({
      input: encryptedData,
      password: plaintextKey,
    }),
  );

  // sanity checks against previous state and set GPG pub keys in state
  if (!state.bitgoGpgPub) {
    state.bitgoGpgPub = {
      gpgKey: bitgoGpgPubInput,
      partyId: MPCv2PartiesEnum.BITGO,
    };
  } else if (bitgoGpgPubInput && state.bitgoGpgPub.gpgKey !== bitgoGpgPubInput) {
    throw new ValidationError(
      `BitGo GPG public key mismatch: expected ${state.bitgoGpgPub.gpgKey}, got ${bitgoGpgPubInput}`,
    );
  }

  if (!state.counterPartyGpgPub) {
    state.counterPartyGpgPub = {
      gpgKey: counterPartyGpgPubInput,
      partyId: source === 'user' ? MPCv2PartiesEnum.BACKUP : MPCv2PartiesEnum.USER,
    };
  } else if (
    counterPartyGpgPubInput &&
    state.counterPartyGpgPub.gpgKey !== counterPartyGpgPubInput
  ) {
    throw new ValidationError(
      `Counterparty GPG public key mismatch: expected ${state.counterPartyGpgPub.gpgKey}, got ${counterPartyGpgPubInput}`,
    );
  }

  if (state.round !== round) {
    throw new ValidationError(`Round mismatch: expected ${state.round}, got ${round}`);
  }
  const { sourceGpgPrv, bitgoGpgPub, counterPartyGpgPub, sessionData } = state;

  // restore session data and cast necessary fields into Uint8Array
  if (!sessionData && round > 1) {
    throw new ValidationError('Session data is missing for round greater than 1');
  } else if (sessionData) {
    sessionData.dkgSessionBytes = new Uint8Array(Object.values(sessionData.dkgSessionBytes));
    sessionData.chainCodeCommitment = new Uint8Array(
      Object.values(sessionData.chainCodeCommitment || {}),
    );
  }
  const session =
    round === 1
      ? new DklsDkg.Dkg(3, 2, source === 'user' ? MPCv2PartiesEnum.USER : MPCv2PartiesEnum.BACKUP)
      : await DklsDkg.Dkg.restoreSession(
          3,
          2,
          source === 'user' ? MPCv2PartiesEnum.USER : MPCv2PartiesEnum.BACKUP,
          sessionData as DklsDkg.DkgSessionData,
        );

  // decrypt incoming messages and handle them to form outgoing messages
  let outgoingMessages: DklsTypes.DeserializedMessages = { broadcastMessages: [], p2pMessages: [] };
  if (round === 1) {
    outgoingMessages.broadcastMessages = [await session.initDkg()];
  } else {
    // decrypt messages, they should be auth by bitgoGpgPub, counterPartyGpgPub; and decrypt by sourceGpgPrv
    const incomingMessages = await DklsComms.decryptAndVerifyIncomingMessages(
      {
        p2pMessages: Object.values(p2pMessages || {}),
        broadcastMessages: Object.values(broadcastMessages || {}),
      },
      [bitgoGpgPub, counterPartyGpgPub],
      [sourceGpgPrv],
    );

    const deserializedIncomingMessages = DklsTypes.deserializeMessages(incomingMessages);

    // generate outgoing messages based on incoming messages
    try {
      outgoingMessages = session.handleIncomingMessages(deserializedIncomingMessages);
    } catch (error: any) {
      throw new Error(`Failed to handle incoming messages: ${error.message}`);
    }
  }

  // cast outgoing messages commitment to Uint8Array if not already
  outgoingMessages.p2pMessages = outgoingMessages.p2pMessages.map((msg) => {
    if (!(msg.commitment instanceof Uint8Array))
      return { ...msg, commitment: new Uint8Array(Object.values(msg.commitment as any)) };
    return msg;
  });

  // sign and encrypt outgoing messages
  const serializedOutgoingMessages = DklsTypes.serializeMessages(outgoingMessages);
  const signedMessages = await DklsComms.encryptAndAuthOutgoingMessages(
    serializedOutgoingMessages,
    [bitgoGpgPub, counterPartyGpgPub],
    [sourceGpgPrv],
  );

  // re-encrypt state
  let newEncryptedData;
  try {
    newEncryptedData = req.bitgo.encrypt({
      input: JSON.stringify({
        ...state,
        round: state.round + 1,
        sessionData: session.getSessionData(),
      }),
      password: plaintextKey,
    });
  } catch (error) {
    logger.error('Encryption error details:', error);
    throw error;
  }

  return {
    round: state.round + 1,
    encryptedDataKey,
    encryptedData: newEncryptedData,
    p2pMessages:
      signedMessages.p2pMessages.length > 0
        ? {
            bitgo: signedMessages.p2pMessages.find((msg) => msg.to === MPCv2PartiesEnum.BITGO),
            counterParty: signedMessages.p2pMessages.find(
              (msg) => msg.to !== MPCv2PartiesEnum.BITGO,
            ),
          }
        : undefined,
    broadcastMessage:
      signedMessages.broadcastMessages.length > 0 ? signedMessages.broadcastMessages[0] : undefined,
  };
}
