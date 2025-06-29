import {
  EnclavedApiSpecRouteRequest,
  MpcV2InitializeResponseType,
  MpcV2RoundState,
} from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { KmsClient } from '../../../kms/kmsClient';
import * as bitgoSdk from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MPCv2PartiesEnum } from '@bitgo/sdk-core/dist/src/bitgo/utils/tss/ecdsa';

export async function mpcV2Initialize(
  req: EnclavedApiSpecRouteRequest<'v1.mpcv2.initialize', 'post'>,
): Promise<MpcV2InitializeResponseType> {
  const { source } = req.decoded;

  // setup clients
  const kms = new KmsClient(req.config);

  // generate keys required
  const sourceGpgKey = await bitgoSdk.generateGPGKeyPair('secp256k1');
  const { plaintextKey, encryptedKey } = await kms.generateDataKey({ keyType: 'AES-256' });

  // store the state of execution
  const state: MpcV2RoundState = {
    round: 1,
    sourceGpgPrv: {
      gpgKey: sourceGpgKey.privateKey,
      partyId: source === 'user' ? MPCv2PartiesEnum.USER : MPCv2PartiesEnum.BACKUP,
    },
  };

  try {
    // Encrypt the state with the plaintext key
    const encryptedData = req.bitgo.encrypt({
      input: JSON.stringify(state),
      password: plaintextKey,
    });

    return {
      gpgPub: sourceGpgKey.publicKey,
      encryptedDataKey: encryptedKey,
      encryptedData,
    };
  } catch (error) {
    logger.debug('Failed to initialize mpc key generation', error);
    console.error('Encryption error details:', error);
    throw error;
  }
}
