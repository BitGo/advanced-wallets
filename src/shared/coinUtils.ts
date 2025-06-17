import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import { CoinFamily } from '@bitgo/statics';
import { BaseCoin } from 'bitgo';
import { AbstractUtxoCoin, Eos, Stx, Xtz } from 'bitgo/dist/types/src/v2/coins';

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
