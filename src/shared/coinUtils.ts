import { AbstractEthLikeNewCoins } from '@bitgo-beta/abstract-eth';
import {
  BackupKeyRecoveryTransansaction,
  FormattedOfflineVaultTxInfo,
} from '@bitgo-beta/abstract-utxo';
import { CosmosCoin } from '@bitgo-beta/abstract-cosmos';
import { CoinFamily, CoinFeature } from '@bitgo-beta/statics';
import { BaseCoin } from '@bitgo-beta/sdk-core';
import { AbstractUtxoCoin } from '@bitgo-beta/abstract-utxo';
import { type Xtz, type Txtz } from '@bitgo-beta/sdk-coin-xtz';
import { type Eos, type Teos } from '@bitgo-beta/sdk-coin-eos';
import { type Stx, type Tstx } from '@bitgo-beta/sdk-coin-stx';

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

export function isCosmosLikeCoin(coin: BaseCoin): coin is CosmosCoin {
  return coin.getConfig().features.includes(CoinFeature.COSMOS_LIKE_COINS);
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

export function isEosCoin(coin: BaseCoin): coin is Eos | Teos {
  return isFamily(coin, CoinFamily.EOS);
}

export function isStxCoin(coin: BaseCoin): coin is Stx | Tstx {
  return isFamily(coin, CoinFamily.STX);
}

export function isXtzCoin(coin: BaseCoin): coin is Xtz | Txtz {
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

export function isEddsaCoin(coin: BaseCoin): boolean {
  if (typeof coin.getMPCAlgorithm !== 'function') {
    return false;
  }
  return coin.getMPCAlgorithm() === 'eddsa';
}

export function isEcdsaCoin(coin: BaseCoin): boolean {
  if (typeof coin.getMPCAlgorithm !== 'function') {
    return false;
  }
  return coin.getMPCAlgorithm() === 'ecdsa';
}
