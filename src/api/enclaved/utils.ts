// TODO: this function is duplicated in multisigTransactioSign.ts but as hardcoded. Replace that code later with this call (to avoid merge conflicts/duplication)
import { KmsClient } from '../../kms/kmsClient';
import { EnclavedConfig } from '../../types';
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
