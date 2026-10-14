import { EddsaMPCv2Utils, generateGPGKeyPair } from '@bitgo-beta/sdk-core';
import { MPCv2PartiesEnum } from '@bitgo-beta/sdk-core/dist/src/bitgo/utils/tss/ecdsa';
import {
  AwmApiSpecRouteRequest,
  EddsaMPCv2KeyGenResponseType,
} from '../routers/advancedWalletManagerApiSpec';
import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import coinFactory from '../../shared/coinFactory';
import { BadRequestError } from '../../shared/errors';

enum EddsaKeyGenShareType {
  Initialize = 'initialize',
  Round1 = 'round1',
  Round2 = 'round2',
  Finalize = 'finalize',
}

export async function eddsaMPCv2KeyGen(
  req: AwmApiSpecRouteRequest<'v1.eddsampcv2.keygen', 'post'>,
): Promise<EddsaMPCv2KeyGenResponseType> {
  const { source, shareType, coin } = req.decoded;
  const bitgo = req.bitgo;
  const keyProvider = new KeyProviderClient(req.config);

  if (shareType === EddsaKeyGenShareType.Initialize) {
    const gpgKeyPair = await generateGPGKeyPair('ed25519');
    const { plaintextKey, encryptedKey } = await keyProvider.generateDataKey({
      keyType: 'AES-256',
    });
    const encryptedUserGpgPrvKey = await bitgo.encrypt({
      input: gpgKeyPair.privateKey,
      password: plaintextKey,
    });
    return { gpgPub: gpgKeyPair.publicKey, encryptedUserGpgPrvKey, encryptedDataKey: encryptedKey };
  }

  const coinInstance = await coinFactory.getCoin(coin, bitgo);
  const eddsaMPCv2Utils = new EddsaMPCv2Utils(bitgo, coinInstance);
  const partyId = source === 'backup' ? MPCv2PartiesEnum.BACKUP : MPCv2PartiesEnum.USER;

  switch (shareType) {
    case EddsaKeyGenShareType.Round1: {
      const { encryptedDataKey, encryptedUserGpgPrvKey, bitgoGpgPubKey, counterPartyGpgPubKey } =
        req.decoded;
      if (
        !encryptedDataKey ||
        !encryptedUserGpgPrvKey ||
        !bitgoGpgPubKey ||
        !counterPartyGpgPubKey
      ) {
        throw new BadRequestError(
          'encryptedDataKey, encryptedUserGpgPrvKey, bitgoGpgPubKey and counterPartyGpgPubKey are required for share type round1',
        );
      }
      const { plaintextKey } = await keyProvider.decryptDataKey({ encryptedKey: encryptedDataKey });
      return await eddsaMPCv2Utils.createOfflineKeyGenRound1Share({
        walletPassphrase: plaintextKey,
        encryptedUserGpgPrvKey,
        bitgoGpgPubKey,
        counterPartyGpgPubKey,
        partyId,
      });
    }
    case EddsaKeyGenShareType.Round2: {
      const {
        encryptedDataKey,
        encryptedUserGpgPrvKey,
        encryptedRound1Session,
        bitgoGpgPubKey,
        counterPartyGpgPubKey,
        bitgoMsg1,
        counterPartyMsg1,
      } = req.decoded;
      if (
        !encryptedDataKey ||
        !encryptedUserGpgPrvKey ||
        !encryptedRound1Session ||
        !bitgoGpgPubKey ||
        !counterPartyGpgPubKey ||
        !bitgoMsg1 ||
        !counterPartyMsg1
      ) {
        throw new BadRequestError(
          'encryptedDataKey, encryptedUserGpgPrvKey, encryptedRound1Session, bitgoGpgPubKey, counterPartyGpgPubKey, bitgoMsg1 and counterPartyMsg1 are required for share type round2',
        );
      }
      const { plaintextKey } = await keyProvider.decryptDataKey({ encryptedKey: encryptedDataKey });
      return await eddsaMPCv2Utils.createOfflineKeyGenRound2Share({
        walletPassphrase: plaintextKey,
        encryptedUserGpgPrvKey,
        encryptedRound1Session,
        bitgoGpgPubKey,
        counterPartyGpgPubKey,
        bitgoMsg1,
        counterPartyMsg1,
        partyId,
      });
    }
    case EddsaKeyGenShareType.Finalize: {
      const {
        encryptedDataKey,
        encryptedRound2Session,
        bitgoGpgPubKey,
        counterPartyGpgPubKey,
        bitgoMsg2,
        counterPartyMsg2,
        bitgoCommonKeychain,
      } = req.decoded;
      if (
        !encryptedDataKey ||
        !encryptedRound2Session ||
        !bitgoGpgPubKey ||
        !counterPartyGpgPubKey ||
        !bitgoMsg2 ||
        !counterPartyMsg2 ||
        !bitgoCommonKeychain
      ) {
        throw new BadRequestError(
          'encryptedDataKey, encryptedRound2Session, bitgoGpgPubKey, counterPartyGpgPubKey, bitgoMsg2, counterPartyMsg2 and bitgoCommonKeychain are required for share type finalize',
        );
      }
      const { plaintextKey } = await keyProvider.decryptDataKey({ encryptedKey: encryptedDataKey });
      const result = await eddsaMPCv2Utils.createOfflineKeyGenFinalizeShare({
        walletPassphrase: plaintextKey,
        encryptedRound2Session,
        bitgoGpgPubKey,
        counterPartyGpgPubKey,
        bitgoMsg2,
        counterPartyMsg2,
        bitgoCommonKeychain,
        partyId,
      });
      await keyProvider.postKey({
        coin,
        source,
        pub: result.commonKeychain,
        prv: result.keyShare,
        type: 'tss',
      });
      return { commonKeychain: result.commonKeychain, source };
    }
    default:
      throw new BadRequestError(
        `Share type ${shareType} not supported for EdDSA MPCv2 key generation`,
      );
  }
}
