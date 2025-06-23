import * as bitgoSdk from '@bitgo/sdk-core';
import * as crypto from 'crypto';
import * as openpgp from 'openpgp';
import {
  EnclavedApiSpecRouteRequest,
  MpcFinalizeRequestType,
} from '../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { KmsClient } from '../../kms/kmsClient';

export async function eddsaFinalize(req: EnclavedApiSpecRouteRequest<'v1.mpc.finalize', 'post'>) {
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
  const eddsaUtils = new bitgoSdk.EddsaUtils(req.bitgo, req.bitgo.coin(coin));

  // indexes
  const sourceIndex = source === 'user' ? 1 : 2;
  const counterPartyIndex = source === 'user' ? 2 : 1;
  const bitgoIndex = 3;

  // Decrypt the encrypted payload using encryptedDataKey to retrieve the previous state of computation
  const decryptedDataKey = await kms.decryptDataKey(encryptedDataKey);
  const previousState = JSON.parse(
    crypto.publicDecrypt(Buffer.from(decryptedDataKey), Buffer.from(encryptedData)).toString(),
  );
  console.log('Decrypted previous state:', previousState);
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
    sourceGpgPub,
    counterPartyGpgPub,
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
  console.log('Constructed keychain:', {
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

    const userSigningMaterial: bitgoSdk.SigningMaterial = {
      uShare: sourcePrivateShare,
      bitgoYShare: bitgoToSourceYShare,
      backupYShare: counterPartyToSourceYShare,
    };

    console.log(userSigningMaterial);
    console.log('Common keychain:', commonKeychain);

    // if counterPartyGpgPub is provided, encrypt the private key share to be sent to the counter party
    if (!sourceToCounterPartyKeyShare) {
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
      enclavedExpressKeyId: 'generated-key-id', // TODO: Update later
    };
  } catch (e) {
    console.log(e);
    throw new Error(`Failed to generate`);
  }
}

/**
 * Helper function to encrypt text using OpenPGP
 */
async function gpgEncrypt(text: string, key: string): Promise<string> {
  return await openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    encryptionKeys: await openpgp.readKey({ armoredKey: key }),
    format: 'armored',
    config: {
      rejectCurves: new Set(),
      showVersion: false,
      showComment: false,
    },
  });
}

/**
 * Helper function to decrypt text using OpenPGP
 */
async function gpgDecrypt(text: string, key: string): Promise<string> {
  const message = await openpgp.readMessage({
    armoredMessage: text,
  });
  const gpgPrivateKey = await openpgp.readPrivateKey({ armoredKey: key });

  const decryptedPrivateShare = (
    await openpgp.decrypt({
      message,
      decryptionKeys: [gpgPrivateKey],
      format: 'utf8',
    })
  ).data;

  return decryptedPrivateShare;
}

// /**
//  * Routine to verify both wallet signature
//  */
// async function verifyWalletSignatures(
//   sourceGpgPub: string,
//   counterPartyGpgPub: string,
//   bitgoGpgPub: string,
//   bitgoKeychain: bitgoSdk.Keychain,
//   decryptedShare: string,
//   sourceIndex: 1 | 2,
// ): Promise<void> {
//   assert(bitgoKeychain.commonKeychain);
//   assert(bitgoKeychain.walletHSMGPGPublicKeySigs);

//   // parse GPG public keys
//   const sourceKey = await openpgp.readKey({ armoredKey: sourceGpgPub });
//   const sourceKeyId = sourceKey.keyPacket.getFingerprint();

//   const counterPartyKey = await openpgp.readKey({ armoredKey: counterPartyGpgPub });
//   const counterPartyKeyId = counterPartyKey.keyPacket.getFingerprint();

//   const bitgoKey = await openpgp.readKey({ armoredKey: bitgoGpgPub });

//   // get the keys used to sign the wallet
//   const walletSignatures = await openpgp.readKeys({
//     armoredKeys: bitgoKeychain.walletHSMGPGPublicKeySigs,
//   });
//   const walletKeyIds = walletSignatures.map((key) => key.keyPacket.getFingerprint());

//   // sanity checks
//   if (walletKeyIds.length !== 2) {
//     throw new Error('Invalid wallet signatures');
//   }
//   if (!walletKeyIds.includes(sourceKeyId)) {
//     throw new Error('Source key signature mismatch');
//   }
//   if (!walletKeyIds.includes(counterPartyKeyId)) {
//     throw new Error('Counter party key signature mismatch');
//   }

//   walletSignatures.forEach(async (walletSignature) => {
//     await verifyWalletSignature({
//       walletSignature,
//       bitgoPub: bitgoKey,
//       commonKeychain: bitgoKeychain.commonKeychain as string,
//       userKeyId: sourceKeyId.padStart(40, '0'),
//       backupKeyId: counterPartyKeyId.padStart(40, '0'),
//       decryptedShare,
//       sourceIndex,
//     });
//   });
// }

// /**
//  * Routine to verify a wallet signature
//  */
// async function verifyWalletSignature(params: {
//   walletSignature: openpgp.Key;
//   bitgoPub: openpgp.Key;
//   commonKeychain: string;
//   userKeyId: string;
//   backupKeyId: string;
//   decryptedShare: string;
//   sourceIndex: 1 | 2;
// }): Promise<void> {
//   const {
//     walletSignature,
//     bitgoPub,
//     commonKeychain,
//     userKeyId,
//     backupKeyId,
//     decryptedShare,
//     sourceIndex,
//   } = params;

//   const isValid = await walletSignature
//     .verifyPrimaryUser([bitgoPub])
//     .then((values) => _.some(values, (value) => value.valid));
//   if (!isValid) {
//     throw new Error('Invalid GPG signature');
//   }
//   const publicShare =
//     Buffer.from(
//       await sodium.crypto_scalarmult_ed25519_base_noclamp(
//         Buffer.from(decryptedShare.slice(0, 64), 'hex'),
//       ),
//     ).toString('hex') + decryptedShare.slice(64);

//   const publicShareRawNotationIndex = 2 + sourceIndex;
//   const primaryUser = await walletSignature.getPrimaryUser();

//   assert(
//     primaryUser.user.otherCertifications[0].rawNotations.length === 5,
//     'invalid wallet signatures',
//   );

//   assert(
//     commonKeychain ===
//       Buffer.from(primaryUser.user.otherCertifications[0].rawNotations[0].value).toString(),
//     'wallet signature does not match common keychain',
//   );
//   assert(
//     userKeyId ===
//       Buffer.from(primaryUser.user.otherCertifications[0].rawNotations[1].value)
//         .toString()
//         .padStart(40, '0'),
//     'wallet signature does not match user key id',
//   );
//   assert(
//     backupKeyId ===
//       Buffer.from(primaryUser.user.otherCertifications[0].rawNotations[2].value)
//         .toString()
//         .padStart(40, '0'),
//     'wallet signature does not match backup key id',
//   );
//   assert(
//     publicShare ===
//       Buffer.from(
//         primaryUser.user.otherCertifications[0].rawNotations[publicShareRawNotationIndex].value,
//       ).toString(),
//     'bitgo share mismatch',
//   );
// }
