// TODO: this function is duplicated in multisigTransactioSign.ts but as hardcoded. Replace that code later with this call (to avoid merge conflicts/duplication)
import { KmsClient } from '../../kms/kmsClient';
import { GenerateDataKeyResponse } from '../../kms/types/dataKey';
import { EnclavedConfig } from '../../types';
export async function retrieveKmsPrvKey({
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
