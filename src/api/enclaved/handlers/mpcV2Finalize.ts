import { DklsComms, DklsDkg, DklsTypes } from '@bitgo-beta/sdk-lib-mpc';
import {
  EnclavedApiSpecRouteRequest,
  MpcV2FinalizeResponseType,
  MpcV2RoundState,
} from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { KmsClient } from '../../../kms/kmsClient';
import assert from 'assert';
import { MPCv2PartiesEnum } from '@bitgo/sdk-core/dist/src/bitgo/utils/tss/ecdsa';

export async function mpcV2Finalize(
  req: EnclavedApiSpecRouteRequest<'v1.mpcv2.finalize', 'post'>,
): Promise<MpcV2FinalizeResponseType> {
  const { source, encryptedData, encryptedDataKey, broadcastMessages, bitgoCommonKeychain } =
    req.decoded;

  // setup clients
  const kms = new KmsClient(req.config);

  // fetch previous state of execution
  const { plaintextKey } = await kms.decryptDataKey({ encryptedKey: encryptedDataKey });
  const state: MpcV2RoundState = JSON.parse(
    req.bitgo.decrypt({
      input: encryptedData,
      password: plaintextKey,
    }),
  );
  if (!state.bitgoGpgPub || !state.counterPartyGpgPub) {
    throw new Error('BitGo GPG public key or counterparty GPG public key is missing in state');
  }
  const { sessionData, sourceGpgPrv, bitgoGpgPub, counterPartyGpgPub } = state;

  // restore session data and cast necessary fields into Uint8Array
  if (!sessionData) {
    throw new Error('Session data is missing for finalization');
  }
  sessionData.dkgSessionBytes = new Uint8Array(Object.values(sessionData.dkgSessionBytes));
  const session = await DklsDkg.Dkg.restoreSession(
    3,
    2,
    source === 'user' ? MPCv2PartiesEnum.USER : MPCv2PartiesEnum.BACKUP,
    sessionData,
  );

  // processing incoming messages
  const incomingMessages = await DklsComms.decryptAndVerifyIncomingMessages(
    {
      broadcastMessages: Object.values(broadcastMessages),
      p2pMessages: [],
    },
    [bitgoGpgPub, counterPartyGpgPub],
    [sourceGpgPrv],
  );
  const deserializedIncomingMessages = DklsTypes.deserializeMessages(incomingMessages);
  session.handleIncomingMessages(deserializedIncomingMessages);

  // get the common keychain
  const privateMaterial = session.getKeyShare();
  const commonKeychain = DklsTypes.getCommonKeychain(privateMaterial);

  // verify the common keychain matches the Bitgo Common keychain
  assert.equal(
    bitgoCommonKeychain,
    commonKeychain,
    'Source and Bitgo Common keychains do not match',
  );

  return {
    source,
    commonKeychain,
  };
}
