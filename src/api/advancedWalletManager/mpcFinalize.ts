import debug from 'debug';
import * as bitgoSdk from '@bitgo-beta/sdk-core';

import {
  AdvancedWalletManagerApiSpecRouteRequest,
  MpcFinalizeRequestType,
} from '../../advancedWalletManager/routers/advancedWalletManagerApiSpec';
import { KmsClient } from '../../kms/kmsClient';
import { gpgDecrypt, gpgEncrypt } from './utils';
import coinFactory from '../../shared/coinFactory';

const debugLogger = debug('bitgo:awm:mpcFinalize');

export async function eddsaFinalize(
  req: AdvancedWalletManagerApiSpecRouteRequest<'v1.mpc.key.finalize', 'post'>,
) {
  // request parsing
  const {
    source,
    encryptedDataKey,
    encryptedData,
    counterPartyGpgPub,
    bitgoKeyChain,
    coin,
  }: MpcFinalizeRequestType = req.decoded;
  const counterPartyToSourceKeyShare = req.decoded.counterPartyKeyShare;

  // setup clients
  const kms = new KmsClient(req.config);
  const MPC = await bitgoSdk.Eddsa.initialize();
  const coinInstance = await coinFactory.getCoin(coin, req.bitgo);
  const eddsaUtils = new bitgoSdk.EddsaUtils(req.bitgo, coinInstance);

  // indexes
  const sourceIndex = source === 'user' ? 1 : 2;
  const counterPartyIndex = source === 'user' ? 2 : 1;
  const bitgoIndex = 3;

  // Decrypt the encrypted payload using encryptedDataKey to retrieve the previous state of computation
  const decryptedDataKey = await kms.decryptDataKey({ encryptedKey: encryptedDataKey });
  const previousState = JSON.parse(
    req.bitgo.decrypt({
      input: encryptedData,
      password: decryptedDataKey.plaintextKey,
    }),
  );
  debugLogger('Decrypted previous state:', previousState);
  const { sourceGpgPub, sourceGpgPrv, sourcePrivateShare } = previousState;
  let sourceToCounterPartyKeyShare = previousState.counterPartyKeyShare;

  // decrypt bitgo private key share
  const bitgoToSourceKeyShare = bitgoKeyChain.keyShares.find(
    (keyShare: any) => keyShare.to === source,
  );
  if (!bitgoToSourceKeyShare) {
    throw new Error(`BitGo key share for source ${source} not found`);
  }
  const bitgoToSourcePrivateShare = await gpgDecrypt(
    bitgoToSourceKeyShare.privateShare,
    sourceGpgPrv,
  );

  await eddsaUtils.verifyWalletSignatures(
    source === 'user' ? sourceGpgPub : counterPartyGpgPub,
    source === 'user' ? counterPartyGpgPub : sourceGpgPub,
    bitgoKeyChain,
    bitgoToSourcePrivateShare,
    sourceIndex,
  );

  // construct yShare and key
  const bitgoToSourceYShare = {
    i: sourceIndex, // to whom
    j: bitgoIndex, // from whom
    y: bitgoToSourceKeyShare.publicShare.slice(0, 64),
    v: bitgoToSourceKeyShare.vssProof,
    u: bitgoToSourcePrivateShare.slice(0, 64),
    chaincode: bitgoToSourcePrivateShare.slice(64),
  };

  // TOOD: clean up, probably doign unnecessary transformations
  const counterPartyToSourcePrivateShare = await gpgDecrypt(
    counterPartyToSourceKeyShare.privateShare,
    sourceGpgPrv,
  );
  const counterPartyToSourceYShare = {
    i: sourceIndex, // to whom
    j: counterPartyIndex, // from whom
    y: counterPartyToSourceKeyShare.publicShare.slice(0, 64),
    v: counterPartyToSourceKeyShare.vssProof,
    u: counterPartyToSourcePrivateShare.slice(0, 64),
    chaincode: counterPartyToSourcePrivateShare.slice(64),
  };

  // Log the constructed keychain for verification
  debugLogger('Constructed keychain:', {
    sourcePrivateShare,
    bitgoToSourceKeyShare,
    counterPartyToSourceKeyShare,
    commonKeychain: bitgoKeyChain.commonKeychain,
  });
  try {
    const combinedKey = MPC.keyCombine(sourcePrivateShare, [
      bitgoToSourceYShare,
      counterPartyToSourceYShare,
    ]);

    // check common keyChain
    const commonKeychain = combinedKey.pShare.y + combinedKey.pShare.chaincode;
    if (commonKeychain !== bitgoKeyChain.commonKeychain) {
      throw new Error('Failed to create user keychain - commonKeychains do not match.');
    }

    const baseSigningMaterial: bitgoSdk.SigningMaterial = {
      uShare: sourcePrivateShare,
      bitgoYShare: bitgoToSourceYShare,
    };
    const sourceSigningMaterial: bitgoSdk.SigningMaterial = baseSigningMaterial;
    if (source === 'user') {
      sourceSigningMaterial.backupYShare = counterPartyToSourceYShare;
    } else {
      sourceSigningMaterial.userYShare = counterPartyToSourceYShare;
    }

    debugLogger(`Common keychain for ${source}:`, commonKeychain);
    await kms.postKey({
      pub: commonKeychain,
      prv: JSON.stringify(sourceSigningMaterial),
      source,
      coin,
      type: 'tss',
    });
    debugLogger(`Stored key ${source} - ${commonKeychain}`);

    // if counterPartyGpgPub is provided, encrypt the private key share to be sent to the counter party
    if (sourceToCounterPartyKeyShare) {
      sourceToCounterPartyKeyShare = {
        ...sourceToCounterPartyKeyShare,
        privateShare: counterPartyGpgPub
          ? await gpgEncrypt(sourceToCounterPartyKeyShare.privateShare, counterPartyGpgPub)
          : sourceToCounterPartyKeyShare.privateShare,
      };
    }

    return {
      combinedKey,
      counterpartyKeyShare: sourceToCounterPartyKeyShare,
      source,
      commonKeychain,
    };
  } catch (e) {
    debugLogger(`Error: ${JSON.stringify(e)}`);
    if (e instanceof Error) {
      debugLogger(`${e.name}: ${e.message}`);
      throw e;
    }
    throw new Error(`Unknown failure: Failed to generate or store key`);
  }
}
