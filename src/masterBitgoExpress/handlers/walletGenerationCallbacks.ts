import { CreateKeychainCallback } from '@bitgo-beta/sdk-core';
import { KeySource } from '../../shared/types';
import {
  AdvancedWalletManagerClient,
  IndependentKeychainResponse,
} from '../clients/advancedWalletManagerClient';

export function createOnchainKeyGenCallback(
  awmUserClient: AdvancedWalletManagerClient,
  awmBackupClient: AdvancedWalletManagerClient,
): CreateKeychainCallback {
  return async ({ source, coin }) => {
    let client: AdvancedWalletManagerClient;
    if (source === KeySource.USER) {
      client = awmUserClient;
    } else if (source === KeySource.BACKUP) {
      client = awmBackupClient;
    } else {
      throw new Error(`Unexpected key source for onchain key generation: ${source}`);
    }

    const keychain = await client.createIndependentKeychain({ source, coin, type: 'independent' });
    return keychain as { pub: string; type: 'independent'; source: typeof source };
  };
}

export function createOnchainKeyGenCallbackForPreGeneratedKeychains(
  preGeneratedKeychains: Record<KeySource.USER | KeySource.BACKUP, IndependentKeychainResponse>,
): CreateKeychainCallback {
  return async ({ source, coin: _ }) => {
    if (!(source in preGeneratedKeychains)) {
      throw new Error(`${source} keychain not available for onchain key generation`);
    }

    const keychain = preGeneratedKeychains[source];
    return {
      source,
      pub: keychain.pub,
      type: 'independent',
    };
  };
}
