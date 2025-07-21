import { BitGo } from 'bitgo';
import { KmsClient } from '../../../kms/kmsClient';
import { EnclavedApiSpecRouteRequest } from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';

export async function postIndependentKey(
  req: EnclavedApiSpecRouteRequest<'v1.key.independent', 'post'>,
) {
  const { source, seed }: { source: string; seed?: string } = req.decoded;

  // setup clients
  const bitgo: BitGo = req.bitgo;
  const kms = new KmsClient(req.config);

  // create public and private key pairs on BitGo SDK
  const coin = bitgo.coin(req.params.coin);
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
