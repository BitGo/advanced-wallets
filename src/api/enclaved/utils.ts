import { createMessage, decrypt, encrypt, readKey, readMessage, readPrivateKey } from 'openpgp';

import { EcdsaTypes } from '@bitgo/sdk-lib-mpc';
import { BitGo } from 'bitgo';
import { KmsClient } from '../../kms/kmsClient';
import { GenerateDataKeyResponse } from '../../kms/types/dataKey';
import { EnclavedConfig } from '../../shared/types';

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

// Notes (please check hope it makes sense!):
// FROM OVC sign-tss-first-trip-form.tsx
// Weird method name as it's not a JSON transaction at this point, it's already a javascript object
// expects an {txRequests: [{transactions: [{unsignedTx: unsignedSweepTx}], walletCoin: 'sol'  }]} object

//import { getExplainTransaction, TransactionWrapper } from '../../pkg/bitgo/transaction-utils'
// import { OfflineVaultUnsignedTransaction } from '../../pkg/bitgo/types'

// Not 100% sure that we need this function as if we're not exporting/downloading anything, why do we need that?
// and also removing this removes TransactionWrapper from the equation.
export async function parseJsonTransactions({
  unsignedTx,
  coin,
  bitgo,
}: {
  unsignedTx: any;
  coin: string;
  bitgo: BitGo;
}): Promise<TransactionWrapper[]> {
  const { txRequests } = { txRequests: [{ transactions: [{ unsignedTx }, coin] }] };
  return txRequests.map((txRequest) => {
    return {
      ...createBaseTransactionWrapper('step-1'),
      txRequest,
    };
  });
}

// This one I copied it without checking so much in depth, in a hurry to have the flow as complete as possible
export type JsonTransactions = {
  signatureShares?: MpcSigningOutput[];
  txRequests?: TxRequest[];
  transactions?: OfflineVaultUnsignedTransaction[];
  bitgoRangeProofChallenge?: EcdsaTypes.SerializedNtildeWithProofs;
};

// the payload in which we wraps the tx, things like the fileName are not gonna make sense here, but what about the id?
function createBaseTransactionWrapper(fileName?: string): TransactionWrapper {
  return {
    id: uuid.v4(),
    isIgnored: false,
    fileName,
  };
}
