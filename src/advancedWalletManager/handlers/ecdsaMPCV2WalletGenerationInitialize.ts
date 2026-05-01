import {
  AwmApiSpecRouteRequest,
  MpcV2InitializeResponseType,
  MpcV2RoundState,
} from '../routers/advancedWalletManagerApiSpec';
import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import * as bitgoSdk from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { MPCv2PartiesEnum } from '@bitgo-beta/sdk-core/dist/src/bitgo/utils/tss/ecdsa';

export async function ecdsaMPCv2Initialize(
  req: AwmApiSpecRouteRequest<'v1.mpcv2.initialize', 'post'>,
): Promise<MpcV2InitializeResponseType> {
  const { source } = req.decoded;

  // setup clients
  const keyProvider = new KeyProviderClient(req.config);

  // generate keys required
  const sourceGpgKey = await bitgoSdk.generateGPGKeyPair('secp256k1');
  const { plaintextKey, encryptedKey } = await keyProvider.generateDataKey({ keyType: 'AES-256' });

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
    logger.error('Failed to initialize mpc key generation', error);
    throw error;
  }
}
