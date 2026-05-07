import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import { AwmApiSpecRouteRequest } from '../routers/advancedWalletManagerApiSpec';
import coinFactory from '../../shared/coinFactory';
import { isExternalSigningEnabledForCoin, isNonBitgoKeySource } from './utils/utils';
import logger from '../../shared/logger';
import { GenerateKeyResponse } from '../keyProviderClient/types/generateKey';
import { PostKeyResponse } from '../keyProviderClient/types/postKey';

async function generateKeyViaKeyProvider<T>(
  keyGenerator: () => Promise<T>,
  keyGeneratorContext: string,
): Promise<T> {
  try {
    logger.info(keyGeneratorContext);
    return await keyGenerator();
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || `Failed to generate key via key provider`,
    };
  }
}

export async function postIndependentKey(
  req: AwmApiSpecRouteRequest<'v1.key.independent', 'post'>,
) {
  const { source, seed }: { source: string; seed?: string } = req.decoded;

  const bitgo: BitGoAPI = req.bitgo;
  const keyProvider = new KeyProviderClient(req.config);
  const coin = await coinFactory.getCoin(req.params.coin, bitgo);

  if (isExternalSigningEnabledForCoin(req.config, coin) && isNonBitgoKeySource(source)) {
    logger.info(
      `External signing is supported for coin=$${coin.getFullName()}. Generating key via key provider for source=${source}`,
    );
    return await generateKeyViaKeyProvider<GenerateKeyResponse>(
      () =>
        keyProvider.generateKey({
          coin: req.params.coin,
          source,
          type: 'independent',
        }),
      `postIndependentKey in external signing mode for coin=${coin.getFullName()} and source=${source}`,
    );
  }
  const { pub, prv } = coin.keychains().create();

  if (!pub) {
    throw new Error('BitGo SDK failed to create public key');
  }

  // post key to key provider for encryption and storage
  return await generateKeyViaKeyProvider<PostKeyResponse>(
    () =>
      keyProvider.postKey({
        pub,
        prv,
        coin: req.params.coin,
        source,
        type: 'independent',
        seed,
      }),
    `postIndependentKey in local mode for coin=${coin.getFullName()} and source=${source}`,
  );
}
