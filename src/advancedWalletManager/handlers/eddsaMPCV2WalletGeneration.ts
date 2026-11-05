import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either';
import * as PathReporter from 'io-ts/lib/PathReporter';
import { EddsaMPCv2Utils, generateGPGKeyPair } from '@bitgo-beta/sdk-core';
import { MPCv2PartiesEnum } from '@bitgo-beta/sdk-core/dist/src/bitgo/utils/tss/ecdsa';
import {
  AwmApiSpecRouteRequest,
  EddsaMpcV2FinalizeBody,
  EddsaMpcV2RoundBody,
  MpcV2FinalizeResponseType,
  MpcV2InitializeResponseType,
  MpcV2RoundResponseType,
} from '../routers/advancedWalletManagerApiSpec';
import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import coinFactory from '../../shared/coinFactory';
import { BadRequestError } from '../../shared/errors';

/**
 * EdDSA MPCv2 DKG handlers. They serve the same v1.mpcv2.* routes as ECDSA and are thin
 * wrappers over EddsaMPCv2Utils.createOfflineKeyGen*Share (the external signer methods): the SDK
 * owns all DKG/GPG state, AWM only wraps it with key-provider encryption. The SDK blobs travel
 * between rounds inside `encryptedData`, the opaque state carrier shared with ECDSA.
 */
type EddsaMPCv2KeyGenState = {
  encryptedUserGpgPrvKey: string;
  bitgoGpgPub?: string;
  counterPartyGpgPub?: string;
  encryptedRound1Session?: string;
  encryptedRound2Session?: string;
};

function decode<A>(codec: t.Type<A, unknown, unknown>, body: unknown): A {
  const result = codec.decode(body);
  if (isLeft(result)) {
    throw new BadRequestError(PathReporter.failure(result.left).join('\n'));
  }
  return result.right;
}

function partyIdFor(source: 'user' | 'backup') {
  return source === 'backup' ? MPCv2PartiesEnum.BACKUP : MPCv2PartiesEnum.USER;
}

async function loadState(
  req: AwmApiSpecRouteRequest<'v1.mpcv2.round' | 'v1.mpcv2.finalize', 'post'>,
  encryptedData: string,
  encryptedDataKey: string,
) {
  const keyProvider = new KeyProviderClient(req.config);
  const { plaintextKey } = await keyProvider.decryptDataKey({ encryptedKey: encryptedDataKey });
  const state: EddsaMPCv2KeyGenState = JSON.parse(
    await req.bitgo.decrypt({ input: encryptedData, password: plaintextKey }),
  );
  return { keyProvider, plaintextKey, state };
}

async function saveState(
  bitgo: { encrypt(p: { input: string; password: string }): Promise<string> },
  state: EddsaMPCv2KeyGenState,
  plaintextKey: string,
): Promise<string> {
  return bitgo.encrypt({ input: JSON.stringify(state), password: plaintextKey });
}

export async function eddsaMPCv2Initialize(
  req: AwmApiSpecRouteRequest<'v1.mpcv2.initialize', 'post'>,
): Promise<MpcV2InitializeResponseType> {
  const keyProvider = new KeyProviderClient(req.config);
  const { plaintextKey, encryptedKey } = await keyProvider.generateDataKey({ keyType: 'AES-256' });
  const gpgKeyPair = await generateGPGKeyPair('ed25519');
  const encryptedUserGpgPrvKey = await req.bitgo.encrypt({
    input: gpgKeyPair.privateKey,
    password: plaintextKey,
  });
  return {
    gpgPub: gpgKeyPair.publicKey,
    encryptedDataKey: encryptedKey,
    encryptedData: await saveState(req.bitgo, { encryptedUserGpgPrvKey }, plaintextKey),
  };
}

export async function eddsaMPCv2Round(
  req: AwmApiSpecRouteRequest<'v1.mpcv2.round', 'post'>,
): Promise<MpcV2RoundResponseType> {
  const body = decode(EddsaMpcV2RoundBody, req.body);
  const { source, encryptedData, encryptedDataKey } = req.decoded;
  const coin = await coinFactory.getCoin(req.decoded.coin, req.bitgo);
  const eddsaMPCv2Utils = new EddsaMPCv2Utils(req.bitgo, coin);
  const partyId = partyIdFor(source);
  const { plaintextKey, state } = await loadState(req, encryptedData, encryptedDataKey);

  if (body.round === 1) {
    const result = await eddsaMPCv2Utils.createOfflineKeyGenRound1Share({
      walletPassphrase: plaintextKey,
      encryptedUserGpgPrvKey: state.encryptedUserGpgPrvKey,
      bitgoGpgPubKey: body.bitgoGpgPub,
      counterPartyGpgPubKey: body.counterPartyGpgPub,
      partyId,
    });
    return {
      round: 2,
      encryptedDataKey,
      encryptedData: await saveState(
        req.bitgo,
        {
          ...state,
          bitgoGpgPub: body.bitgoGpgPub,
          counterPartyGpgPub: body.counterPartyGpgPub,
          encryptedRound1Session: result.encryptedRound1Session,
        },
        plaintextKey,
      ),
      signedMsg: result.signedMsg1,
    };
  }

  if (!state.encryptedRound1Session || !state.bitgoGpgPub || !state.counterPartyGpgPub) {
    throw new BadRequestError('Round 1 has not been completed for this EdDSA MPCv2 state');
  }
  const result = await eddsaMPCv2Utils.createOfflineKeyGenRound2Share({
    walletPassphrase: plaintextKey,
    encryptedUserGpgPrvKey: state.encryptedUserGpgPrvKey,
    encryptedRound1Session: state.encryptedRound1Session,
    bitgoGpgPubKey: state.bitgoGpgPub,
    counterPartyGpgPubKey: state.counterPartyGpgPub,
    bitgoMsg1: body.bitgoMsg,
    counterPartyMsg1: body.counterPartyMsg,
    partyId,
  });
  return {
    round: 3,
    encryptedDataKey,
    encryptedData: await saveState(
      req.bitgo,
      { ...state, encryptedRound2Session: result.encryptedRound2Session },
      plaintextKey,
    ),
    signedMsg: result.signedMsg2,
  };
}

export async function eddsaMPCv2Finalize(
  req: AwmApiSpecRouteRequest<'v1.mpcv2.finalize', 'post'>,
): Promise<MpcV2FinalizeResponseType> {
  const { bitgoMsg, counterPartyMsg } = decode(EddsaMpcV2FinalizeBody, req.body);
  const { source, encryptedData, encryptedDataKey, bitgoCommonKeychain } = req.decoded;
  const coin = await coinFactory.getCoin(req.decoded.coin, req.bitgo);
  const eddsaMPCv2Utils = new EddsaMPCv2Utils(req.bitgo, coin);
  const { keyProvider, plaintextKey, state } = await loadState(
    req,
    encryptedData,
    encryptedDataKey,
  );

  if (!state.encryptedRound2Session || !state.bitgoGpgPub || !state.counterPartyGpgPub) {
    throw new BadRequestError('Round 2 has not been completed for this EdDSA MPCv2 state');
  }
  const result = await eddsaMPCv2Utils.createOfflineKeyGenFinalizeShare({
    walletPassphrase: plaintextKey,
    encryptedRound2Session: state.encryptedRound2Session,
    bitgoGpgPubKey: state.bitgoGpgPub,
    counterPartyGpgPubKey: state.counterPartyGpgPub,
    bitgoMsg2: bitgoMsg,
    counterPartyMsg2: counterPartyMsg,
    bitgoCommonKeychain,
    partyId: partyIdFor(source),
  });

  await keyProvider.postKey({
    coin: req.decoded.coin,
    source,
    pub: result.commonKeychain,
    prv: result.keyShare,
    type: 'tss',
  });
  return { source, commonKeychain: result.commonKeychain };
}
