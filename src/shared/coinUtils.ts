import { FormattedOfflineVaultTxInfo, BackupKeyRecoveryTransansaction } from '@bitgo/abstract-utxo';
import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import { CoinFamily } from '@bitgo/statics';
import { BaseCoin, BitGo } from 'bitgo';
import { AbstractUtxoCoin, Eos, Stx, Xtz } from 'bitgo/dist/types/src/v2/coins';
import { RequestTracer } from '@bitgo/sdk-core';
import { EnclavedExpressClient } from '../api/master/clients/enclavedExpressClient';

export function isEthLikeCoin(coin: BaseCoin): coin is AbstractEthLikeNewCoins {
  const isEthPure = isFamily(coin, CoinFamily.ETH);

  const isEthLike =
    isFamily(coin, CoinFamily.ETHW) || // ethw has its own family. as the others
    isFamily(coin, CoinFamily.RBTC) ||
    isFamily(coin, CoinFamily.ETC) ||
    isFamily(coin, CoinFamily.AVAXC) ||
    isFamily(coin, CoinFamily.POLYGON) ||
    isFamily(coin, CoinFamily.ARBETH) ||
    isFamily(coin, CoinFamily.OPETH) ||
    isFamily(coin, CoinFamily.BSC) ||
    isFamily(coin, CoinFamily.BASEETH) ||
    isFamily(coin, CoinFamily.COREDAO) ||
    isFamily(coin, CoinFamily.OAS) ||
    isFamily(coin, CoinFamily.FLR) ||
    isFamily(coin, CoinFamily.SGB) ||
    isFamily(coin, CoinFamily.WEMIX) ||
    isFamily(coin, CoinFamily.XDC);

  return isEthPure || isEthLike;
}

export function isUtxoCoin(coin: BaseCoin): coin is AbstractUtxoCoin {
  const isBtc = isFamily(coin, CoinFamily.BTC);

  const isBtcLike =
    isFamily(coin, CoinFamily.LTC) ||
    isFamily(coin, CoinFamily.BCH) ||
    isFamily(coin, CoinFamily.ZEC) ||
    isFamily(coin, CoinFamily.DASH) ||
    isFamily(coin, CoinFamily.BTG);

  return isBtc || isBtcLike;
}

export function isEosCoin(coin: BaseCoin): coin is Eos {
  return isFamily(coin, CoinFamily.EOS);
}

export function isStxCoin(coin: BaseCoin): coin is Stx {
  return isFamily(coin, CoinFamily.STX);
}

export function isXtzCoin(coin: BaseCoin): coin is Xtz {
  return isFamily(coin, CoinFamily.XTZ);
}

function isFamily(coin: BaseCoin, family: CoinFamily) {
  return Boolean(coin && coin.getFamily() === family);
}

export function isFormattedOfflineVaultTxInfo(
  obj: FormattedOfflineVaultTxInfo | BackupKeyRecoveryTransansaction,
): obj is FormattedOfflineVaultTxInfo {
  return obj && 'txInfo' in obj && 'txHex' in obj && 'feeInfo' in obj;
}

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
  params: { source: 'user' | 'backup'; pubkey?: string };
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
  
  if (!signingKeychain || !signingKeychain.pub) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }
  
  if (params.pubkey && params.pubkey !== signingKeychain.pub) {
    throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
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
}) {
  return async function customSigningFunction(signParams: any) {
    return enclavedExpressClient.signMultisig({
      txPrebuild: signParams.txPrebuild,
      source,
      pub,
    });
  };
}
