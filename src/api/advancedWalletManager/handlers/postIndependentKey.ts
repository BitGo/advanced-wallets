import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { KmsClient } from '../../../kms/kmsClient';
import { AdvancedWalletManagerApiSpecRouteRequest } from '../../../advancedWalletManager/routers/advancedWalletManagerApiSpec';
import coinFactory from '../../../shared/coinFactory';

export async function postIndependentKey(
  req: AdvancedWalletManagerApiSpecRouteRequest<'v1.key.independent', 'post'>,
) {
  const { source, seed }: { source: string; seed?: string } = req.decoded;

  // setup clients
  const bitgo: BitGoAPI = req.bitgo;
  const kms = new KmsClient(req.config);

  // create public and private key pairs on BitGo SDK
  const coin = await coinFactory.getCoin(req.params.coin, bitgo);
  const { pub, prv } = coin.keychains().create();

  if (!pub) {
    throw new Error('BitGo SDK failed to create public key');
  }

  // post key to KMS for encryption and storage
  try {
    return await kms.postKey({
      pub,
      prv,
      coin: req.params.coin,
      source,
      type: 'independent',
      seed,
    });
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to post key to KMS',
    };
  }
}
