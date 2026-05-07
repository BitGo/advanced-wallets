import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import { TransactionPrebuild } from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { AwmApiSpecRouteRequest } from '../routers/advancedWalletManagerApiSpec';
import coinFactory from '../../shared/coinFactory';
import { isExternalSigningEnabledForCoin, isNonBitgoKeySource } from './utils/utils';
import { SignResponse } from '../keyProviderClient/types/sign';
import { MPCType } from './ecdsaEddsaSignTransaction';

export async function signMultisigTransaction(
  req: AwmApiSpecRouteRequest<'v1.multisig.sign', 'post'>,
): Promise<any> {
  const {
    source,
    pub,
    txPrebuild,
    walletPubs,
  }: { source: string; pub: string; txPrebuild: TransactionPrebuild; walletPubs?: string[] } =
    req.body;

  const bitgo = req.bitgo;
  const keyProvider = new KeyProviderClient(req.config);
  const coin = await coinFactory.getCoin(req.params.coin, bitgo);

  if (isExternalSigningEnabledForCoin(req.config, coin)) {
    return signTransactionExternally({ keyProvider, pub, source, txPrebuild });
  }

  // Retrieve the private key from key provider
  let prv: string;
  try {
    const res = await keyProvider.getKey({ pub, source });
    prv = res.prv;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to retrieve key from key provider',
    };
  }

  // Sign the transaction using BitGo SDK
  try {
    const signedTx = await coin.signTransaction({
      txPrebuild,
      prv,
      ...(walletPubs && { pubs: walletPubs }),
    });
    return signedTx;
  } catch (error) {
    logger.error('error while signing wallet transaction:', error);
    throw error;
  }
}

async function signTransactionExternally({
  keyProvider,
  pub,
  source,
  txPrebuild,
}: {
  keyProvider: KeyProviderClient;
  pub: string;
  source: string;
  txPrebuild: TransactionPrebuild;
}): Promise<{ txHex: string }> {
  if (!isNonBitgoKeySource(source)) {
    throw new Error(`Invalid source: ${source}. Must be 'user' or 'backup'.`);
  }

  let res: SignResponse;
  try {
    if (!txPrebuild.txHex) {
      throw new Error(`txPrebuild must include txHex for external signing`);
    }

    res = await keyProvider.sign({
      pub,
      source,
      signablePayload: txPrebuild.txHex,
      algorithm: MPCType.ECDSA,
    });
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to sign transaction via key provider',
    };
  }

  return { txHex: res.signature };
}
