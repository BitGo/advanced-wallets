import * as express from 'express';
import { KmsClient } from '../../kms/kmsClient';
import { BitGo, RequestTracer, TransactionPrebuild } from 'bitgo';
import logger from '../../logger';

export async function signMultisigTransaction(
  req: express.Request,
  res: express.Response,
): Promise<any> {
  const {
    source,
    pub,
    txPrebuild,
  }: { source: string; pub: string; txPrebuild: TransactionPrebuild } = req.body;

  if (!source || !pub) {
    throw new Error('Source and public key are required for signing');
  } else if (!txPrebuild || !txPrebuild.wallet) {
    throw new Error('Transaction prebuild is required for signing');
  }

  const reqId = new RequestTracer();
  const bitgo: BitGo = req.body.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);
  const kms = new KmsClient();

  // verify transaction prebuild
  try {
    await baseCoin.verifyTransaction({
      txParams: { ...txPrebuild.buildParams },
      txPrebuild,
      wallet: txPrebuild.wallet,
      verification: {},
      reqId: reqId,
      walletType: 'onchain',
    });
  } catch (e) {
    const err = e as Error;
    logger.error('transaction prebuild failed local validation:', err.message);
    logger.error('transaction prebuild:', JSON.stringify(txPrebuild, null, 2));
    logger.error(err);
  }

  // Retrieve the private key from KMS
  let prv: string;
  try {
    const res = await kms.getKey({ pub, source });
    prv = res.prv;
  } catch (error: any) {
    res.status(error.status || 500).json({
      message: error.message || 'Failed to retrieve key from KMS',
    });
    return;
  }

  // Sign the transaction using BitGo SDK
  const coin = bitgo.coin(req.params.coin);
  try {
    return await coin.signTransaction({ txPrebuild, prv });
  } catch (error) {
    console.log('error while signing wallet transaction ', error);
    throw error;
  }
}
