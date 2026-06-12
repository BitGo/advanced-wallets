import {
  Keychain,
  KeychainsTriplet,
  promiseProps,
  RequestTracer,
  SupplementGenerateWalletOptions,
  Wallet,
  WalletWithKeychains,
} from '@bitgo-beta/sdk-core';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import _ from 'lodash';
import { IndependentKeychainResponse } from '../../clients/advancedWalletManagerClient';
import coinFactory from '../../../shared/coinFactory';

export function getBaseWalletParams(multisigType: 'onchain' | 'tss') {
  return { m: 2, n: 3, keys: [] as string[], type: 'advanced', multisigType } as const;
}

export interface RegisterKeychainsAndCreateWalletParams {
  coin: string;
  bitgo: BitGoAPI;
  userKeychain: IndependentKeychainResponse;
  backupKeychain: IndependentKeychainResponse;
  walletParams: SupplementGenerateWalletOptions;
  isDistributedCustody?: boolean;
}

export async function registerKeychainsAndCreateWallet({
  bitgo,
  coin,
  walletParams,
  userKeychain,
  backupKeychain,
  isDistributedCustody,
}: RegisterKeychainsAndCreateWalletParams): Promise<WalletWithKeychains> {
  const baseCoin = await coinFactory.getCoin(coin, bitgo);
  const reqId = new RequestTracer();

  const registerKeychain = async (keyChain: IndependentKeychainResponse): Promise<Keychain> => {
    const registered = await baseCoin.keychains().add({
      pub: keyChain.pub,
      keyType: keyChain.type,
      source: keyChain.source,
      reqId,
    });
    return _.extend({}, registered, keyChain);
  };

  const {
    userKeychain: registeredUser,
    backupKeychain: registeredBackup,
    bitgoKeychain,
  }: KeychainsTriplet = await promiseProps({
    userKeychain: registerKeychain(userKeychain),
    backupKeychain: registerKeychain(backupKeychain),
    bitgoKeychain: baseCoin.keychains().createBitGo({
      enterprise: walletParams.enterprise,
      keyType: 'independent',
      reqId,
      isDistributedCustody,
    }),
  });

  const keychains: KeychainsTriplet = {
    userKeychain: registeredUser,
    backupKeychain: registeredBackup,
    bitgoKeychain,
  };

  const finalWalletParams = await baseCoin.supplementGenerateWallet(
    { ...walletParams, keys: [registeredUser.id, registeredBackup.id, bitgoKeychain.id] },
    keychains,
  );

  bitgo.setRequestTracer(reqId);
  const newWallet = await bitgo.post(baseCoin.url('/wallet/add')).send(finalWalletParams).result();

  return {
    wallet: new Wallet(bitgo, baseCoin, newWallet),
    userKeychain: registeredUser,
    backupKeychain: registeredBackup,
    bitgoKeychain,
    responseType: 'WalletWithKeychains',
  };
}
