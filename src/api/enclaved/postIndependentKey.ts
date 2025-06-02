import { BitGo } from 'bitgo';
import * as express from 'express';
import { KmsClient } from '../../kms/kmsClient';

export async function postIndependentKey(
  req: express.Request,
  res: express.Response,
): Promise<any> {
  const { source, seed }: { source: string; seed?: string } = req.body;
  if (!source) {
    throw new Error('Source is required for key generation');
  }

  // setup clients
  const bitgo: BitGo = req.body.bitgo;
  const kms = new KmsClient();

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
    res.status(error.status || 500).json({
      message: error.message || 'Failed to post key to KMS',
    });
    return;
  }
}
