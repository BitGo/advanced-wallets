import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { BaseCoin, CustomSigningFunction, RequestTracer, Wallet } from '@bitgo-beta/sdk-core';
import coinFactory from '../../../shared/coinFactory';
import { AdvancedWalletManagerClient } from '../../clients/advancedWalletManagerClient';
import { MasterExpressConfig } from '../../../shared/types';

/**
 * Fetch wallet and signing keychain, with validation for source and pubkey.
 * Throws with a clear error if not found or mismatched.
 */

export async function getWalletAndSigningKeychain({
  bitgo,
  coin,
  walletId,
  params,
  reqId,
  KeyIndices,
}: {
  bitgo: BitGoAPI;
  coin: string;
  walletId: string;
  params: { source: 'user' | 'backup'; pubkey?: string; commonKeychain?: string };
  reqId: RequestTracer;
  KeyIndices: { USER: number; BACKUP: number; BITGO: number };
}) {
  const baseCoin = await coinFactory.getCoin(coin, bitgo);

  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });

  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  const keyIdIndex = params.source === 'user' ? KeyIndices.USER : KeyIndices.BACKUP;
  const signingKeychain = await baseCoin.keychains().get({
    id: wallet.keyIds()[keyIdIndex],
  });

  if (!signingKeychain) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }

  const isTss = wallet.multisigType() === 'tss';

  if (isTss) {
    if (params.commonKeychain && signingKeychain.commonKeychain !== params.commonKeychain) {
      throw new Error(
        `Common keychain provided does not match the keychain on wallet for ${params.source}`,
      );
    }
  } else {
    if (params.pubkey && params.pubkey !== signingKeychain.pub) {
      throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
    }
  }

  return { baseCoin, wallet, signingKeychain };
}
/**
 * Create a custom signing function that delegates to awmClient.signMultisig.
 */

export function makeCustomSigningFunction({
  awmClient,
  source,
  pub,
  walletPubs,
}: {
  awmClient: AdvancedWalletManagerClient;
  source: 'user' | 'backup';
  pub: string;
  walletPubs?: string[];
}): CustomSigningFunction {
  return async function customSigningFunction(signParams: any) {
    return awmClient.signMultisig({
      txPrebuild: signParams.txPrebuild,
      source,
      pub,
      walletPubs,
    });
  };
}

export async function getWalletPubs({
  baseCoin,
  wallet,
  KeyIndices,
}: {
  baseCoin: BaseCoin;
  wallet: Wallet;
  KeyIndices: { USER: number; BACKUP: number; BITGO: number };
}): Promise<string[] | undefined> {
  const [userKeychain, backupKeychain, bitgoKeychain] = await Promise.all([
    baseCoin.keychains().get({ id: wallet.keyIds()[KeyIndices.USER] }),
    baseCoin.keychains().get({ id: wallet.keyIds()[KeyIndices.BACKUP] }),
    baseCoin.keychains().get({ id: wallet.keyIds()[KeyIndices.BITGO] }),
  ]);
  return userKeychain?.pub && backupKeychain?.pub && bitgoKeychain?.pub
    ? [userKeychain.pub, backupKeychain.pub, bitgoKeychain.pub]
    : undefined;
}

export function checkRecoveryMode(config: MasterExpressConfig) {
  if (!config.recoveryMode) {
    throw new Error(
      'Recovery operations are not enabled. The server must be in recovery mode to perform this action.',
    );
  }
}
