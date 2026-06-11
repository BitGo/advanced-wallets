import { CreateKeychainCallback } from '@bitgo-beta/sdk-core';
import { AdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';

export function createOnchainKeyGenCallback(
  awmUserClient: AdvancedWalletManagerClient,
  awmBackupClient: AdvancedWalletManagerClient,
): CreateKeychainCallback {
  return async ({ source, coin }) => {
    const client = source === 'user' ? awmUserClient : awmBackupClient;
    const keychain = await client.createIndependentKeychain({ source, coin, type: 'independent' });
    return keychain as { pub: string; type: 'independent'; source: typeof source };
  };
}
