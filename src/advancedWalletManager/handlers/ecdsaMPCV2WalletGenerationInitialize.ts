import {
  AwmApiSpecRouteRequest,
  MpcV2InitializeResponseType,
  MpcV2RoundState,
} from '../routers/advancedWalletManagerApiSpec';
import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import * as bitgoSdk from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { MPCv2PartiesEnum } from '@bitgo-beta/sdk-core/dist/src/bitgo/utils/tss/ecdsa';
import { buildStateBindingAdata, sealStateBlob, STATE_BINDING_DOMAIN } from './utils/stateBinding';

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
    // Bind the keygen state to its flow, source, and consuming round so it
    // cannot be replayed into any other decrypt path or round slot.
    const encryptedData = await sealStateBlob(req.bitgo, {
      plaintextKey,
      plaintext: JSON.stringify(state),
      adata: buildStateBindingAdata(STATE_BINDING_DOMAIN.ECDSA_MPCV2_KEYGEN, {
        source,
        round: '1',
      }),
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
