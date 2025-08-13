import { KmsClient } from '../kmsClient/kmsClient';
import { TransactionPrebuild } from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { AwmApiSpecRouteRequest } from '../routers/advancedWalletManagerApiSpec';
import coinFactory from '../../shared/coinFactory';

export async function signMultisigTransaction(
  req: AwmApiSpecRouteRequest<'v1.multisig.sign', 'post'>,
): Promise<any> {
  const {
    source,
    pub,
    txPrebuild,
  }: { source: string; pub: string; txPrebuild: TransactionPrebuild } = req.body;

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
