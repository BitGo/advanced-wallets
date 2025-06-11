import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import { BaseCoin } from 'bitgo';
import { AbstractUtxoCoin, Eos, Stx, Xtz } from 'bitgo/dist/types/src/v2/coins';

export function isEthCoin(coin: BaseCoin): coin is AbstractEthLikeNewCoins {
  const isEthPure =
    isFamily(coin, 'eth', 'gteth') ||
    isFamily(coin, 'eth', 'hteth') ||
    isFamily(coin, 'ethw', 'tethw');

  const isEthLike =
    isFamily(coin, 'rbtc', 'trbtc') ||
    isFamily(coin, 'etc', 'tetc') ||
    isFamily(coin, 'avaxc', 'tavaxc') ||
    isFamily(coin, 'polygon', 'tpolygon') ||
    isFamily(coin, 'arbeth', 'tarbeth') ||
    isFamily(coin, 'opeth', 'topeth') ||
    isFamily(coin, 'bsc', 'tbsc') ||
    isFamily(coin, 'baseeth', 'tbaseeth') ||
    isFamily(coin, 'coredao', 'tcoredao') ||
    isFamily(coin, 'oas', 'toas') ||
    isFamily(coin, 'flr', 'tflr') ||
    isFamily(coin, 'sgb', 'tsgb') ||
    isFamily(coin, 'wemix', 'twemix') ||
    isFamily(coin, 'xdc', 'txdc');

  return isEthPure || isEthLike;
}

export function isUtxoCoin(coin: BaseCoin): coin is AbstractUtxoCoin {
  // how to check if coin is UTXO? so many families
  const isBtc = isFamily(coin, 'btc', 'tbtc');

  const isBtcLike =
    isFamily(coin, 'ltc', 'tltc') ||
    isFamily(coin, 'bch', 'tbch') ||
    isFamily(coin, 'zec', 'tzec') ||
    isFamily(coin, 'dash', 'tdash') ||
    isFamily(coin, 'doge', 'tdoge') ||
    isFamily(coin, 'btg', 'tbtg');

  return isBtc || isBtcLike;
}

//look for those on OVC repo
//https://github.com/BitGo/offline-vault-console/blob/7f850cdd10c89ceb850c69759349b9e0bbfb56db/frontend/src/pkg/bitgo/transaction-utils.ts#L595
export function isEosCoin(coin: BaseCoin): coin is Eos {
  return isFamily(coin, 'eos', 'teos');
}

export function isStxCoin(coin: BaseCoin): coin is Stx {
  return isFamily(coin, 'stx', 'tstx');
}

export function isXtzCoin(coin: BaseCoin): coin is Xtz {
  // Tezos faucet: https://faucet.ghostnet.teztnets.com/
  return isFamily(coin, 'xtz', 'txtz');
}

function isFamily(coin: BaseCoin, coinFamily: string, testFamily: string) {
  if (!coin) {
    return false;
  }
  const family = coin.getFamily();
  return family === coinFamily || family === testFamily;
}
