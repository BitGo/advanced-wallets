// ECDSA MPCv2 specific imports
import { DklsTypes, DklsComms, DklsDsg } from '@bitgo-beta/sdk-lib-mpc';

import { TxRequest, SignatureShareRecord, SignatureShareType } from '@bitgo-beta/sdk-core';

// MPCv2 type definitions
import {
  MPCv2PartyFromStringOrNumber,
  MPCv2SignatureShareRound1Input,
  MPCv2SignatureShareRound1Output,
  MPCv2SignatureShareRound2Input,
  MPCv2SignatureShareRound2Output,
  MPCv2SignatureShareRound3Input,
} from '@bitgo/public-types';
import assert from 'assert';
import { bitgoGpgKey } from '../../mocks/gpgKeys';

export async function signBitgoMPCv2Round1(
  bitgoSession: DklsDsg.Dsg,
  txRequest: TxRequest,
  userShare: SignatureShareRecord,
  userGPGPubKey: string,
): Promise<TxRequest> {
  assert(
    txRequest.transactions && txRequest.transactions.length === 1,
    'txRequest.transactions is not an array of length 1',
  );
  txRequest.transactions[0].signatureShares.push(userShare);
  // Do the actual signing on BitGo's side based on User's messages
  const signatureShare = JSON.parse(userShare.share) as MPCv2SignatureShareRound1Input;
  const deserializedMessages = DklsTypes.deserializeMessages({
    p2pMessages: [],
    broadcastMessages: [
      {
        from: signatureShare.data.msg1.from,
        payload: signatureShare.data.msg1.message,
      },
    ],
  });
  const bitgoToUserRound1BroadcastMsg = await bitgoSession.init();
  const bitgoToUserRound2Msg = bitgoSession.handleIncomingMessages({
    p2pMessages: [],
    broadcastMessages: deserializedMessages.broadcastMessages,
  });
  const serializedBitGoToUserRound1And2Msgs = DklsTypes.serializeMessages({
    p2pMessages: bitgoToUserRound2Msg.p2pMessages,
    broadcastMessages: [bitgoToUserRound1BroadcastMsg],
  });

  const authEncMessages = await DklsComms.encryptAndAuthOutgoingMessages(
    serializedBitGoToUserRound1And2Msgs,
    [getUserPartyGpgKeyPublic(userGPGPubKey)],
    [getBitGoPartyGpgKeyPrv(bitgoGpgKey.private)],
  );

  const bitgoToUserSignatureShare: MPCv2SignatureShareRound1Output = {
    type: 'round1Output',
    data: {
      msg1: {
        from: authEncMessages.broadcastMessages[0].from as MPCv2PartyFromStringOrNumber,
        signature: authEncMessages.broadcastMessages[0].payload.signature,
        message: authEncMessages.broadcastMessages[0].payload.message,
      },
      msg2: {
        from: authEncMessages.p2pMessages[0].from as MPCv2PartyFromStringOrNumber,
        to: authEncMessages.p2pMessages[0].to as MPCv2PartyFromStringOrNumber,
        encryptedMessage: authEncMessages.p2pMessages[0].payload.encryptedMessage,
        signature: authEncMessages.p2pMessages[0].payload.signature,
      },
    },
  };
  txRequest.transactions[0].signatureShares.push({
    from: SignatureShareType.BITGO,
    to: SignatureShareType.USER,
    share: JSON.stringify(bitgoToUserSignatureShare),
  });
  return txRequest;
}

export async function signBitgoMPCv2Round2(
  bitgoSession: DklsDsg.Dsg,
  txRequest: TxRequest,
  userShare: SignatureShareRecord,
  userGPGPubKey: string,
): Promise<{ txRequest: TxRequest; bitgoMsg4: DklsTypes.SerializedBroadcastMessage }> {
  assert(
    txRequest.transactions && txRequest.transactions.length === 1,
    'txRequest.transactions is not an array of length 1',
  );
  txRequest.transactions[0].signatureShares.push(userShare);

  // Do the actual signing on BitGo's side based on User's messages
  const parsedSignatureShare = JSON.parse(userShare.share) as MPCv2SignatureShareRound2Input;
  const serializedMessages = await DklsComms.decryptAndVerifyIncomingMessages(
    {
      p2pMessages: [
        {
          from: parsedSignatureShare.data.msg2.from,
          to: parsedSignatureShare.data.msg2.to,
          payload: {
            encryptedMessage: parsedSignatureShare.data.msg2.encryptedMessage,
            signature: parsedSignatureShare.data.msg2.signature,
          },
        },
        {
          from: parsedSignatureShare.data.msg3.from,
          to: parsedSignatureShare.data.msg3.to,
          payload: {
            encryptedMessage: parsedSignatureShare.data.msg3.encryptedMessage,
            signature: parsedSignatureShare.data.msg3.signature,
          },
        },
      ],
      broadcastMessages: [],
    },
    [getUserPartyGpgKeyPublic(userGPGPubKey)],
    [getBitGoPartyGpgKeyPrv(bitgoGpgKey.private)],
  );
  const deserializedMessages2 = DklsTypes.deserializeMessages({
    p2pMessages: [serializedMessages.p2pMessages[0]],
    broadcastMessages: [],
  });

  const bitgoToUserRound3Msg = bitgoSession.handleIncomingMessages(deserializedMessages2);
  const serializedBitGoToUserRound3Msgs = DklsTypes.serializeMessages(bitgoToUserRound3Msg);

  const authEncMessages = await DklsComms.encryptAndAuthOutgoingMessages(
    serializedBitGoToUserRound3Msgs,
    [getUserPartyGpgKeyPublic(userGPGPubKey)],
    [getBitGoPartyGpgKeyPrv(bitgoGpgKey.private)],
  );

  const bitgoToUserSignatureShare: MPCv2SignatureShareRound2Output = {
    type: 'round2Output',
    data: {
      msg3: {
        from: authEncMessages.p2pMessages[0].from as MPCv2PartyFromStringOrNumber,
        to: authEncMessages.p2pMessages[0].to as MPCv2PartyFromStringOrNumber,
        encryptedMessage: authEncMessages.p2pMessages[0].payload.encryptedMessage,
        signature: authEncMessages.p2pMessages[0].payload.signature,
      },
    },
  };

  // handling user msg3 but not returning bitgo msg4 since its stored on bitgo side only
  const deserializedMessages3 = DklsTypes.deserializeMessages({
    p2pMessages: [serializedMessages.p2pMessages[1]],
    broadcastMessages: [],
  });
  const deserializedBitgoMsg4 = bitgoSession.handleIncomingMessages(deserializedMessages3);
  const serializedBitGoToUserRound4Msgs = DklsTypes.serializeMessages(deserializedBitgoMsg4);

  txRequest.transactions[0].signatureShares.push({
    from: SignatureShareType.BITGO,
    to: SignatureShareType.USER,
    share: JSON.stringify(bitgoToUserSignatureShare),
  });
  return { txRequest, bitgoMsg4: serializedBitGoToUserRound4Msgs.broadcastMessages[0] };
}

export async function signBitgoMPCv2Round3(
  bitgoSession: DklsDsg.Dsg,
  userShare: SignatureShareRecord,
  userGPGPubKey: string,
): Promise<{ userMsg4: MPCv2SignatureShareRound3Input }> {
  const parsedSignatureShare = JSON.parse(userShare.share) as MPCv2SignatureShareRound3Input;
  const serializedMessages = await DklsComms.decryptAndVerifyIncomingMessages(
    {
      p2pMessages: [],
      broadcastMessages: [
        {
          from: parsedSignatureShare.data.msg4.from,
          payload: {
            message: parsedSignatureShare.data.msg4.message,
            signature: parsedSignatureShare.data.msg4.signature,
          },
        },
      ],
    },
    [getUserPartyGpgKeyPublic(userGPGPubKey)],
    [getBitGoPartyGpgKeyPrv(bitgoGpgKey.private)],
  );
  const deserializedMessages = DklsTypes.deserializeMessages({
    p2pMessages: [],
    broadcastMessages: [serializedMessages.broadcastMessages[0]],
  });
  bitgoSession.handleIncomingMessages(deserializedMessages);

  return {
    userMsg4: parsedSignatureShare,
  };
}

function getBitGoPartyGpgKeyPrv(bitgoPrvKey: string): DklsTypes.PartyGpgKey {
  return {
    partyId: 2,
    gpgKey: bitgoPrvKey,
  };
}

function getUserPartyGpgKeyPublic(userPubKey: string): DklsTypes.PartyGpgKey {
  return {
    partyId: 0,
    gpgKey: userPubKey,
  };
}
