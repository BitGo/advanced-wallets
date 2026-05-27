import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import {
  BaseCoin,
  TransactionPrebuild,
  FullySignedTransaction,
  HalfSignedTransaction,
} from '@bitgo-beta/sdk-core';
import { AbstractEthLikeNewCoins, SignFinalOptions } from '@bitgo-beta/abstract-eth';
import logger from '../../shared/logger';
import { AwmApiSpecRouteRequest } from '../routers/advancedWalletManagerApiSpec';
import coinFactory from '../../shared/coinFactory';
import { isExternalSigningEnabledForCoin, isNonBitgoKeySource } from './utils/utils';
import { SignResponse } from '../keyProviderClient/types/sign';
import { MPCType } from './ecdsaEddsaSignTransaction';
import { isEthLikeCoin } from '../../shared/coinUtils';
import { UserOrBackupKey } from '../../shared/types';

type EthTxPrebuild = SignFinalOptions['txPrebuild'];

/**
 * External signing response extends SDK's HalfSignedTransaction with
 * operationHash and signature fields required for external HSM signing.
 */
interface EthExternalSigningResponse extends Omit<HalfSignedTransaction, 'halfSigned'> {
  halfSigned: HalfSignedTransaction['halfSigned'] & {
    operationHash: string;
    signature: string;
  };
}

type ExternalSigningResponse = FullySignedTransaction | EthExternalSigningResponse;

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
    return signTransactionExternally({ keyProvider, pub, source, txPrebuild, coin });
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

function isEthTransactionPrebuild(txPrebuild: TransactionPrebuild): txPrebuild is EthTxPrebuild {
  const ethPrebuild = txPrebuild as Partial<EthTxPrebuild>;
  return Array.isArray(ethPrebuild.recipients) && ethPrebuild.nextContractSequenceId != null;
}

async function signTransactionExternally({
  keyProvider,
  pub,
  source,
  txPrebuild,
  coin,
}: {
  keyProvider: KeyProviderClient;
  pub: string;
  source: string;
  txPrebuild: TransactionPrebuild;
  coin: BaseCoin;
}): Promise<ExternalSigningResponse> {
  if (!isNonBitgoKeySource(source)) {
    throw new Error(`Invalid source: ${source}. Must be 'user' or 'backup'.`);
  }

  if (isEthLikeCoin(coin)) {
    if (!isEthTransactionPrebuild(txPrebuild)) {
      throw new Error('ETH prebuild missing required fields: recipients, nextContractSequenceId');
    }
    return signEthTransactionExternally({
      keyProvider,
      pub,
      source: source as UserOrBackupKey,
      txPrebuild,
      coin,
    });
  }

  if (!txPrebuild.txHex) {
    throw new Error(`txPrebuild must include txHex for non-ETH external signing`);
  }

  let res: SignResponse;
  try {
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

async function signEthTransactionExternally({
  keyProvider,
  pub,
  source,
  txPrebuild,
  coin,
}: {
  keyProvider: KeyProviderClient;
  pub: string;
  source: UserOrBackupKey;
  txPrebuild: EthTxPrebuild;
  coin: AbstractEthLikeNewCoins;
}): Promise<EthExternalSigningResponse> {
  const { recipients, nextContractSequenceId: sequenceId } = txPrebuild;
  if (!recipients || sequenceId == null) {
    throw new Error(
      'txPrebuild must include recipients and nextContractSequenceId for ETH transaction',
    );
  }

  const expireTime = coin.getDefaultExpireTime();
  const operationHash = coin.getOperationSha3ForExecuteAndConfirm(
    recipients,
    expireTime,
    sequenceId,
  );

  let res: SignResponse;
  try {
    res = await keyProvider.sign({
      pub,
      source,
      signablePayload: operationHash,
      algorithm: MPCType.ECDSA,
    });
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to sign ETH transaction via key provider',
    };
  }

  return {
    halfSigned: {
      recipients,
      expireTime,
      contractSequenceId: sequenceId,
      operationHash,
      signature: res.signature,
      isBatch: txPrebuild.isBatch,
    },
  };
}
