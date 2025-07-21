import { KmsClient } from '../../../kms/kmsClient';
import { TransactionPrebuild } from '@bitgo-beta/sdk-core';
import logger from '../../../logger';
import { EnclavedApiSpecRouteRequest } from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import coinFactory from '../../../shared/coinFactory';

export async function signMultisigTransaction(
  req: EnclavedApiSpecRouteRequest<'v1.multisig.sign', 'post'>,
): Promise<any> {
  const {
    source,
    pub,
    txPrebuild,
  }: { source: string; pub: string; txPrebuild: TransactionPrebuild } = req.body;

  if (!source || !pub) {
    throw new Error('Source and public key are required for signing');
  } else if (!txPrebuild) {
    throw new Error('Transaction prebuild is required for signing');
  }

  const bitgo = req.bitgo;
  const kms = new KmsClient(req.config);

  // Retrieve the private key from KMS
  let prv: string;
  try {
    const res = await kms.getKey({ pub, source });
    prv = res.prv;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to retrieve key from KMS',
    };
  }

  // Sign the transaction using BitGo SDK
  const coin = await coinFactory.getCoin(req.params.coin, bitgo);
  try {
    const signedTx = await coin.signTransaction({ txPrebuild, prv });
    // The signed transaction format depends on the coin type
    return signedTx;
  } catch (error) {
    logger.error('error while signing wallet transaction:', error);
    throw error;
  }
}
