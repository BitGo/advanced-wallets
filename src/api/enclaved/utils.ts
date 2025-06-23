import { KmsClient } from '../../kms/kmsClient';
import { EnclavedConfig } from '../../types';
import { decrypt, readMessage, readPrivateKey, SerializedKeyPair } from 'openpgp';

/**
 * Decrypts a private share using the provided GPG key
 * @param privateShare - The encrypted private share to decrypt
 * @param userGpgKey - The user's GPG key pair used for decryption
 * @returns The decrypted private share as a string
 */
export async function decryptPrivateShare(
  privateShare: string,
  userGpgKey: SerializedKeyPair<string>,
): Promise<string> {
  const privateShareMessage = await readMessage({
    armoredMessage: privateShare,
  });
  const userGpgPrivateKey = await readPrivateKey({ armoredKey: userGpgKey.privateKey });

  const decryptedPrivateShare = (
    await decrypt({
      message: privateShareMessage,
      decryptionKeys: [userGpgPrivateKey],
      format: 'utf8',
    })
  ).data;

  return decryptedPrivateShare.toString();
}

export async function retrieveKmsKey({
  pub,
  source,
  cfg,
}: {
  pub: string;
  source: string;
  cfg: EnclavedConfig;
}): Promise<string> {
  const kms = new KmsClient(cfg);
  // Retrieve the private key from KMS
  let prv: string;
  try {
    const res = await kms.getKey({ pub, source });
    prv = res.prv;
    return prv;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to retrieve key from KMS',
    };
  }
}
