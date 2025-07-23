import type { BitGoAPI } from '@bitgo-beta/sdk-api';
import type { BaseCoin } from '@bitgo-beta/sdk-core';
import { coins } from '@bitgo-beta/statics';

const registerCoinWithSDK = (name: string, sdk: BitGoAPI, register: (sdk: BitGoAPI) => void) => {
  register(sdk);
  return sdk.coin(name);
};

class CoinBlocklistedError extends Error {
  public constructor(coin: string) {
    super(`coin: ${coin} is not allowed`);
  }
}

const CoinFactory = () => {
  /**
   * @throws {CoinBlocklistedError | UnsupportedCoinError}
   */
  const getCoin = async (coinName: string, sdk: BitGoAPI): Promise<BaseCoin> => {
    const blocklist = [
      'tbtg',
      'erc721:bsctoken',
      'terc721:bsctoken',
      'erc1155:bsctoken',
      'terc1155:bsctoken',
      'erc721:witch',
      'erc721:token',
      'terc721:token',
      'erc1155:token',
      'terc1155:token',
      'nonstandard:token',
      'tnonstandard:token',
      'terc721:bitgoerc721',
      'terc1155:bitgoerc1155',
      'txrp:tst-rP9jPyP5kyvFRb6ZiRghAGw5u8SGAmU4bd',
    ];

    if (blocklist.includes(coinName)) {
      throw new CoinBlocklistedError(coinName);
    }

    const moduleName = coins.has(coinName) ? coins.get(coinName).family : undefined;

    if (!moduleName) {
      return sdk.coin(coinName);
    }

    switch (moduleName) {
      case 'ada': {
        const { register } = await import('@bitgo-beta/sdk-coin-ada');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'algo': {
        const { register } = await import('@bitgo-beta/sdk-coin-algo');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'apt': {
        const { register } = await import('@bitgo-beta/sdk-coin-apt');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'atom': {
        const { register } = await import('@bitgo-beta/sdk-coin-atom');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'avaxc': {
        const { register } = await import('@bitgo-beta/sdk-coin-avaxc');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'avaxp': {
        const { register } = await import('@bitgo-beta/sdk-coin-avaxp');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'bch': {
        const { register } = await import('@bitgo-beta/sdk-coin-bch');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'bcha': {
        const { register } = await import('@bitgo-beta/sdk-coin-bcha');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'bld': {
        const { register } = await import('@bitgo-beta/sdk-coin-bld');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'bsc': {
        const { register } = await import('@bitgo-beta/sdk-coin-bsc');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'bsv': {
        const { register } = await import('@bitgo-beta/sdk-coin-bsv');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'btc': {
        const { register } = await import('@bitgo-beta/sdk-coin-btc');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'btg': {
        const { register } = await import('@bitgo-beta/sdk-coin-btg');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'celo': {
        const { register } = await import('@bitgo-beta/sdk-coin-celo');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'cspr': {
        const { register } = await import('@bitgo-beta/sdk-coin-cspr');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'dash': {
        const { register } = await import('@bitgo-beta/sdk-coin-dash');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'doge': {
        const { register } = await import('@bitgo-beta/sdk-coin-doge');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'dot': {
        const { register } = await import('@bitgo-beta/sdk-coin-dot');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'eos': {
        const { register } = await import('@bitgo-beta/sdk-coin-eos');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'etc': {
        const { register } = await import('@bitgo-beta/sdk-coin-etc');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'eth': {
        const { register } = await import('@bitgo-beta/sdk-coin-eth');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'ethw': {
        const { register } = await import('@bitgo-beta/sdk-coin-ethw');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'hash': {
        const { register } = await import('@bitgo-beta/sdk-coin-hash');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'hbar': {
        const { register } = await import('@bitgo-beta/sdk-coin-hbar');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'ltc': {
        const { register } = await import('@bitgo-beta/sdk-coin-ltc');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'near': {
        const { register } = await import('@bitgo-beta/sdk-coin-near');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'polygon': {
        const { register } = await import('@bitgo-beta/sdk-coin-polygon');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'polyx': {
        const { register } = await import('@bitgo-beta/sdk-coin-polyx');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'osmo': {
        const { register } = await import('@bitgo-beta/sdk-coin-osmo');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'rbtc': {
        const { register } = await import('@bitgo-beta/sdk-coin-rbtc');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'sei': {
        const { register } = await import('@bitgo-beta/sdk-coin-sei');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'sol': {
        const { register } = await import('@bitgo-beta/sdk-coin-sol');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'stx': {
        const { register } = await import('@bitgo-beta/sdk-coin-stx');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'sui': {
        const { register } = await import('@bitgo-beta/sdk-coin-sui');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'tao': {
        const { register } = await import('@bitgo-beta/sdk-coin-tao');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'tia': {
        const { register } = await import('@bitgo-beta/sdk-coin-tia');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'ton': {
        const { register } = await import('@bitgo-beta/sdk-coin-ton');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'coreum': {
        const { register } = await import('@bitgo-beta/sdk-coin-coreum');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'islm': {
        const { register } = await import('@bitgo-beta/sdk-coin-islm');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'bera': {
        const { register } = await import('@bitgo-beta/sdk-coin-bera');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'trx': {
        const { register } = await import('@bitgo-beta/sdk-coin-trx');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'xlm': {
        const { register } = await import('@bitgo-beta/sdk-coin-xlm');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'xrp': {
        const { register } = await import('@bitgo-beta/sdk-coin-xrp');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'xtz': {
        const { register } = await import('@bitgo-beta/sdk-coin-xtz');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'zec': {
        const { register } = await import('@bitgo-beta/sdk-coin-zec');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'zeta': {
        const { register } = await import('@bitgo-beta/sdk-coin-zeta');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'injective': {
        const { register } = await import('@bitgo-beta/sdk-coin-injective');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'baby': {
        const { register } = await import('@bitgo-beta/sdk-coin-baby');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'cronos': {
        const { register } = await import('@bitgo-beta/sdk-coin-cronos');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'asi': {
        const { register } = await import('@bitgo-beta/sdk-coin-asi');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'initia': {
        const { register } = await import('@bitgo-beta/sdk-coin-initia');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'opeth': {
        const { register } = await import('@bitgo-beta/sdk-coin-opeth');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'arbeth': {
        const { register } = await import('@bitgo-beta/sdk-coin-arbeth');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'zketh': {
        const { register } = await import('@bitgo-beta/sdk-coin-zketh');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'thor': {
        const { register } = await import('@bitgo-beta/sdk-coin-rune');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'coredao': {
        const { register } = await import('@bitgo-beta/sdk-coin-coredao');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'oas': {
        const { register } = await import('@bitgo-beta/sdk-coin-oas');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'icp': {
        const { register } = await import('@bitgo-beta/sdk-coin-icp');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'flr': {
        const { register } = await import('@bitgo-beta/sdk-coin-flr');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'sgb': {
        const { register } = await import('@bitgo-beta/sdk-coin-sgb');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'wemix': {
        const { register } = await import('@bitgo-beta/sdk-coin-wemix');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'xdc': {
        const { register } = await import('@bitgo-beta/sdk-coin-xdc');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'mon': {
        const { register } = await import('@bitgo-beta/sdk-coin-mon');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'world': {
        const { register } = await import('@bitgo-beta/sdk-coin-world');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'stt': {
        const { register } = await import('@bitgo-beta/sdk-coin-stt');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'soneium': {
        const { register } = await import('@bitgo-beta/sdk-coin-soneium');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      case 'vet': {
        const { register } = await import('@bitgo-beta/sdk-coin-vet');
        return registerCoinWithSDK(coinName, sdk, register);
      }
      default: {
        return sdk.coin(coinName);
      }
    }
  };

  const safeGetCoin = async (coinName: string, sdk: BitGoAPI): Promise<BaseCoin | undefined> => {
    return getCoin(coinName, sdk).catch(() => undefined);
  };

  return {
    getCoin,
    safeGetCoin,
  };
};

const coinFactory = CoinFactory();

export default coinFactory;
