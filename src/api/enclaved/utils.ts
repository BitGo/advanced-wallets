import { createMessage, decrypt, encrypt, readKey, readMessage, readPrivateKey } from 'openpgp';

import { KmsClient } from '../../kms/kmsClient';
import { GenerateDataKeyResponse } from '../../kms/types/dataKey';
import { EnclavedConfig } from '../../shared/types';

export async function retrieveKmsPrvKey({
  pub,
  source,
  cfg,
  options,
}: {
  pub: string;
  source: string;
  cfg: EnclavedConfig;
  options?: {
    useLocalEncipherment?: boolean;
  };
}): Promise<string> {
  const kms = new KmsClient(cfg);
  // Retrieve the private key from KMS
  let prv: string;
  try {
    const res = await kms.getKey({ pub, source, options });
    prv = res.prv;
    return prv;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to retrieve key from KMS',
    };
  }
}

/**
 * Helper function to encrypt text using OpenPGP
 *
 * @param text {string} The message to encrypt
 * @param key {string} The encryption key
 *
 * @return {string} encrypted string
 */
export async function gpgEncrypt(text: string, key: string): Promise<string> {
  return (
    await encrypt({
      message: await createMessage({ text }),
      encryptionKeys: await readKey({ armoredKey: key }),
      format: 'armored',
      config: {
        rejectCurves: new Set(),
        showVersion: false,
        showComment: false,
      },
    })
  ).toString();
}

/**
 * Helper function to a decrypt text using OpenPGP
 *
 * @param text {string} The message to decrypt
 * @param key {string} The decryption key
 *
 * @return {string} The decrypted message
 */
export async function gpgDecrypt(text: string, key: string): Promise<string> {
  const message = await readMessage({
    armoredMessage: text,
  });
  const gpgPrivateKey = await readPrivateKey({ armoredKey: key });

  const decryptedPrivateShare = (
    await decrypt({
      message,
      decryptionKeys: [gpgPrivateKey],
      format: 'utf8',
    })
  ).data;

  return decryptedPrivateShare.toString();
}

export async function generateDataKey({
  keyType,
  cfg,
}: {
  keyType: 'AES-256' | 'RSA-2048' | 'ECDSA-P256';
  cfg: EnclavedConfig;
}): Promise<GenerateDataKeyResponse> {
  try {
    const kms = new KmsClient(cfg);
    return await kms.generateDataKey({ keyType });
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to generate data key from KMS',
    };
  }
}

export async function decryptDataKey({
  encryptedDataKey,
  cfg,
}: {
  encryptedDataKey: string;
  cfg: EnclavedConfig;
}): Promise<string> {
  try {
    const kms = new KmsClient(cfg);
    const decryptedDataKey = await kms.decryptDataKey({ encryptedKey: encryptedDataKey });
    return decryptedDataKey.plaintextKey;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to decrypt data key from KMS',
    };
  }
}

export function checkRecoveryMode(config: EnclavedConfig) {
  if (!config.recoveryMode) {
    throw new Error(
      'Recovery operations are not enabled. The server must be in recovery mode to perform this action.',
    );
  }
}
