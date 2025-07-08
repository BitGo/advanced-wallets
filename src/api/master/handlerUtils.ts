import { BitGo, CustomSigningFunction, RequestTracer } from 'bitgo';
import { EnclavedExpressClient } from './clients/enclavedExpressClient';

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
  bitgo: BitGo;
  coin: string;
  walletId: string;
  params: { source: 'user' | 'backup'; pubkey?: string; commonKeychain?: string };
  reqId: RequestTracer;
  KeyIndices: { USER: number; BACKUP: number; BITGO: number };
}) {
  const baseCoin = bitgo.coin(coin);

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

  if (params.pubkey && params.pubkey !== signingKeychain.pub) {
    throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
  }

  if (params.commonKeychain && signingKeychain.commonKeychain !== params.commonKeychain) {
    throw new Error(
      `Common keychain provided does not match the keychain on wallet for ${params.source}`,
    );
  }

  return { baseCoin, wallet, signingKeychain };
}
/**
 * Create a custom signing function that delegates to enclavedExpressClient.signMultisig.
 */

export function makeCustomSigningFunction({
  enclavedExpressClient,
  source,
  pub,
}: {
  enclavedExpressClient: EnclavedExpressClient;
  source: 'user' | 'backup';
  pub: string;
}): CustomSigningFunction {
  return async function customSigningFunction(signParams: any) {
    return enclavedExpressClient.signMultisig({
      txPrebuild: signParams.txPrebuild,
      source,
      pub,
    });
  };
}
