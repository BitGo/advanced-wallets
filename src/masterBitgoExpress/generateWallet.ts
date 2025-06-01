import {
  AddKeychainOptions,
  Keychain,
  KeychainsTriplet,
  promiseProps,
  RequestTracer,
  SupplementGenerateWalletOptions,
  WalletWithKeychains,
  type Wallet,
} from '@bitgo/sdk-core';
import { createEnclavedExpressClient } from './enclavedExpressClient';
import { BitGo } from 'bitgo';

export type GenerateMultiSigOnPremWalletParams = {
  coin: string;
  label: string;
  enterprise?: string;
};

/**
 * Generate multisig wallet keys using enclaved express and create the wallet in BitGo
 * @param {BitGo} bitgo the sdk instance
 * @param {GenerateMultiSigOnPremWalletParams} params
 */
export async function generateMultiSigOnPremWallet({
  bitgo,
  params,
}: {
  bitgo: BitGo;
  params: GenerateMultiSigOnPremWalletParams;
}): Promise<WalletWithKeychains> {
  const baseCoin = bitgo.coin(params.coin);

  const enclavedExpressClient = createEnclavedExpressClient(params.coin);
  if (!enclavedExpressClient) {
    throw new Error(
      'Enclaved express client not configured - enclaved express features will be disabled',
    );
  }

  const reqId = new RequestTracer();

  // Create wallet parameters with type assertion to allow 'onprem' subtype
  const walletParams = {
    label: params.label,
    m: 2,
    n: 3,
    keys: [],
    type: 'cold',
    subType: 'onPrem',
    multisigType: 'onchain',
  } as unknown as SupplementGenerateWalletOptions; // TODO: Add onprem to the SDK subType and remove "unknown" type casting

  const userKeychainPromise = async (): Promise<Keychain> => {
    const userKeychain = await enclavedExpressClient.createIndependentKeychain({
      source: 'user',
      coin: params.coin,
      type: 'independent',
    });
    const userKeychainParams: AddKeychainOptions = {
      pub: userKeychain.pub,
      keyType: userKeychain.type,
      source: userKeychain.source,
      reqId,
    };

    const newUserKeychain = await baseCoin.keychains().add(userKeychainParams);
    return { ...newUserKeychain, ...userKeychain };
  };

  const backupKeychainPromise = async (): Promise<Keychain> => {
    const backupKeychain = await enclavedExpressClient.createIndependentKeychain({
      source: 'backup',
      coin: params.coin,
      type: 'independent',
    });
    const backupKeychainParams: AddKeychainOptions = {
      pub: backupKeychain.pub,
      keyType: backupKeychain.type,
      source: backupKeychain.source,
      reqId,
    };

    const newBackupKeychain = await baseCoin.keychains().add(backupKeychainParams);
    return { ...newBackupKeychain, ...backupKeychain };
  };

  const { userKeychain, backupKeychain, bitgoKeychain }: KeychainsTriplet = await promiseProps({
    userKeychain: userKeychainPromise(),
    backupKeychain: backupKeychainPromise(),
    bitgoKeychain: baseCoin.keychains().createBitGo({
      enterprise: params.enterprise,
      reqId,
      // not applicable for onPrem wallets
      isDistributedCustody: false,
    }),
  });

  walletParams.keys = [userKeychain.id, backupKeychain.id, bitgoKeychain.id];

  const keychains = {
    userKeychain,
    backupKeychain,
    bitgoKeychain,
  };

  const finalWalletParams = await baseCoin.supplementGenerateWallet(walletParams, keychains);

  bitgo.setRequestTracer(reqId);
  const wallet = (await baseCoin.wallets().add({
    ...finalWalletParams,
    enterprise: params.enterprise,
    reqId,
    // Not valid for onPrem wallets
    isDistributedCustody: false,
  })) as Wallet;

  return {
    wallet: wallet,
    userKeychain: userKeychain,
    backupKeychain: backupKeychain,
    bitgoKeychain: bitgoKeychain,
    responseType: 'WalletWithKeychains',
  };
}
