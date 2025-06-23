import { YShare, EddsaUtils, Eddsa, SigningMaterial } from '@bitgo/sdk-core';
import { KeyCombine } from '@bitgo/sdk-core/dist/src/account-lib/mpc/tss';
import {
  BitGoKeyShareType,
  EnclavedApiSpecRouteRequest,
} from '../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { decryptPrivateShare } from './utils';

export async function eddsaFinalize(req: EnclavedApiSpecRouteRequest<'v1.mpc.finalize', 'post'>) {
  const { encryptedData, source, backupToUserShare, backupGpgKey, userToBackupShare, coin } =
    req.decoded;

  // Validate source-specific requirements
  if (source === 'user' && !(backupToUserShare || backupGpgKey)) {
    // TODO: Update error handling
    throw new Error('Invalid request');
  }

  if (source === 'backup' && !userToBackupShare) {
    throw new Error('Invalid request: userToBackupShare must be provided when source is backup');
  }

  if (source === 'backup') {
    throw new Error('Backup source not implemented');
  }

  // For user source:
  // 1. Parse the encrypted user share data
  const userShareData = JSON.parse(encryptedData);
  console.log(userShareData);
  const { myPrivateKeyShare, myGpgKey } = userShareData;

  // 2. Get and validate bitgo key shares
  const bitgoKeychain = req.body.bitGoKeychain;
  const bitgoKeyShares = bitgoKeychain.keyShares;
  if (!bitgoKeyShares) {
    throw new Error('Missing BitGo key shares');
  }

  const bitGoToUserShare = bitgoKeyShares.find(
    (keyShare: BitGoKeyShareType) => keyShare.from === 'bitgo' && keyShare.to === 'user',
  );
  if (!bitGoToUserShare) {
    throw new Error('Missing BitGo to User key share');
  }

  // 3. Decrypt private shares and verify signatures
  const eddsaUtils = new EddsaUtils(req.bitgo, req.bitgo.coin(coin));

  // Decrypt BitGo to User share
  const bitGoToUserPrivateShare = await decryptPrivateShare(
    bitGoToUserShare.privateShare,
    myGpgKey,
  );

  await eddsaUtils.verifyWalletSignatures(
    myGpgKey.publicKey,
    backupGpgKey ?? '',
    bitgoKeychain,
    bitGoToUserPrivateShare,
    1,
  );

  // 4. Construct the YShare with decrypted private share
  const bitgoToUser: YShare = {
    i: 1,
    j: 3,
    y: bitGoToUserShare.publicShare.slice(0, 64),
    v: bitGoToUserShare.vssProof,
    u: bitGoToUserPrivateShare.slice(0, 64),
    chaincode: bitGoToUserPrivateShare.slice(64),
  };

  let backupToUser: YShare | undefined;

  if (backupToUserShare) {
    const backupToUserPrivateShare = await decryptPrivateShare(
      backupToUserShare.privateShare,
      myGpgKey,
    );

    backupToUser = {
      i: 1,
      j: 2,
      y: backupToUserShare.publicShare.slice(0, 64),
      v: backupToUserShare.vssProof,
      u: backupToUserPrivateShare.slice(0, 64),
      chaincode: backupToUserPrivateShare.slice(64),
    };
  }

  // Log the constructed keychain for verification
  console.log('Constructed keychain:', {
    myPrivateKeyShare,
    bitgoToUser,
    backupToUser,
    commonKeychain: bitgoKeychain.commonKeychain,
  });
  const eddsa = await Eddsa.initialize();
  try {
    const userCombined = eddsa.keyCombine(myPrivateKeyShare, [backupToUser as YShare, bitgoToUser]);
    const commonKeychain = userCombined?.pShare.y + userCombined?.pShare.chaincode;
    if (commonKeychain !== bitgoKeychain.commonKeychain) {
      throw new Error('Failed to create user keychain - commonKeychains do not match.');
    }

    const userSigningMaterial: SigningMaterial = {
      uShare: myPrivateKeyShare,
      bitgoYShare: bitgoToUser,
      backupYShare: backupToUser,
    };

    console.log(userSigningMaterial);
    console.log('Common keychain:', commonKeychain);

    // 5. Return the response
    return {
      commonKeychain: commonKeychain,
      enclavedExpressKeyId: 'generated-key-id', // TODO: Update later
      source,
    };
  } catch (e) {
    console.log(e);
    throw new Error(`Failed to generate`);
  }
}
