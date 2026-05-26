import { createMessage, decrypt, encrypt, readKey, readMessage, readPrivateKey } from 'openpgp';
import { BaseCoin, type EddsaUtils, Eddsa, EDDSA } from '@bitgo-beta/sdk-core';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import * as bitgoSdk from '@bitgo-beta/sdk-core';

import { KeyProviderClient } from '../../keyProviderClient/keyProviderClient';
import { GenerateDataKeyResponse } from '../../keyProviderClient/types/dataKey';
import { AdvancedWalletManagerConfig, KeySource, SigningMode } from '../../../shared/types';
import { isEthLikeCoin, isUtxoCoin } from '../../../shared/coinUtils';

export function buildBackupKmsConfig(
  cfg: AdvancedWalletManagerConfig,
): AdvancedWalletManagerConfig {
  if (!cfg.backupKmsUrl) {
    return cfg;
  }
  return {
    ...cfg,
    keyProviderUrl: cfg.backupKmsUrl,
    ...(cfg.backupKmsServerCaCert !== undefined && {
      keyProviderServerCaCert: cfg.backupKmsServerCaCert,
    }),
    ...(cfg.backupKmsClientTlsKey !== undefined && {
      keyProviderClientTlsKey: cfg.backupKmsClientTlsKey,
    }),
    ...(cfg.backupKmsClientTlsCert !== undefined && {
      keyProviderClientTlsCert: cfg.backupKmsClientTlsCert,
    }),
    ...(cfg.backupKmsServerCertAllowSelfSigned !== true && {
      keyProviderServerCertAllowSelfSigned: cfg.backupKmsServerCertAllowSelfSigned,
    }),
  };
}

export async function retrieveKeyProviderPrvKey({
  pub,
  source,
  cfg,
}: {
  pub: string;
  source: string;
  cfg: AdvancedWalletManagerConfig;
}): Promise<string> {
  const effectiveCfg = source === 'backup' ? buildBackupKmsConfig(cfg) : cfg;
  const keyProvider = new KeyProviderClient(effectiveCfg);
  // Retrieve the private key from key provider
  let prv: string;
  try {
    const res = await keyProvider.getKey({ pub, source });
    prv = res.prv;
    return prv;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to retrieve key from key provider',
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
  cfg: AdvancedWalletManagerConfig;
}): Promise<GenerateDataKeyResponse> {
  try {
    const keyProvider = new KeyProviderClient(cfg);
    return await keyProvider.generateDataKey({ keyType });
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to generate data key from key provider',
    };
  }
}

export async function decryptDataKey({
  encryptedDataKey,
  cfg,
}: {
  encryptedDataKey: string;
  cfg: AdvancedWalletManagerConfig;
}): Promise<string> {
  try {
    const keyProvider = new KeyProviderClient(cfg);
    const decryptedDataKey = await keyProvider.decryptDataKey({ encryptedKey: encryptedDataKey });
    return decryptedDataKey.plaintextKey;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to decrypt data key from key provider',
    };
  }
}

export function isExternalSigningModeEnabled(config: AdvancedWalletManagerConfig): boolean {
  return config.signingMode === SigningMode.EXTERNAL;
}

export function isExternalSigningEnabledForCoin(
  config: AdvancedWalletManagerConfig,
  coin: BaseCoin,
): boolean {
  return isExternalSigningModeEnabled(config) && (isUtxoCoin(coin) || isEthLikeCoin(coin));
}

export function isNonBitgoKeySource(source: string): source is KeySource.USER | KeySource.BACKUP {
  return source === KeySource.USER || source === KeySource.BACKUP;
}

export function checkRecoveryMode(config: AdvancedWalletManagerConfig) {
  if (!config.recoveryMode) {
    throw new Error(
      'Recovery operations are not enabled. The server must be in recovery mode to perform this action.',
    );
  }
}

export async function verifyWalletSignatures({
  bitgo,
  coin,
  verifySignatures,
}: {
  bitgo: BitGoAPI;
  coin: BaseCoin;
  verifySignatures: Parameters<EddsaUtils['verifyWalletSignatures']>;
}) {
  const eddsaUtils = new bitgoSdk.EddsaUtils(bitgo, coin);
  return eddsaUtils.verifyWalletSignatures(...verifySignatures);
}

export async function eddsaKeyCombine(
  params: Parameters<Eddsa['keyCombine']>,
): Promise<EDDSA.KeyCombine> {
  const eddsa = await bitgoSdk.Eddsa.initialize();
  return eddsa.keyCombine(...params);
}
