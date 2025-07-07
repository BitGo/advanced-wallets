import {
  RequestTracer,
  PrebuildTransactionOptions,
  Memo,
  KeyIndices,
  Wallet,
  SendManyOptions,
  BitGoBase,
  PendingApprovals,
  PrebuildTransactionResult,
  Keychain,
  TxRequest,
} from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { handleEddsaSigning } from './eddsa';
import { handleEcdsaSigning } from './ecdsa';
import { EnclavedExpressClient } from '../clients/enclavedExpressClient';

/**
 * Defines the structure for a single recipient in a send-many transaction.
 * This provides strong typing and autocompletion within the handler.
 */
interface Recipient {
  address: string;
  amount: string | number;
  feeLimit?: string;
  data?: string;
  tokenName?: string;
  tokenData?: any;
}

export async function handleSendMany(req: MasterApiSpecRouteRequest<'v1.wallet.sendMany', 'post'>) {
  const enclavedExpressClient = req.enclavedExpressClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);

  const params = req.decoded;
  params.recipients = params.recipients as Recipient[];

  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  // if (wallet.type() !== 'cold' || wallet.subType() !== 'onPrem') {
  //   throw new Error('Wallet is not an on-prem wallet');
  // }

  const keyIdIndex = params.source === 'user' ? KeyIndices.USER : KeyIndices.BACKUP;
  logger.info(`Key ID index: ${keyIdIndex}`);
  logger.info(`Key IDs: ${JSON.stringify(wallet.keyIds(), null, 2)}`);

  // Get the signing keychains
  const signingKeychain = await baseCoin.keychains().get({
    id: wallet.keyIds()[keyIdIndex],
  });

  if (!signingKeychain) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }
  if (params.pubkey && signingKeychain.pub !== params.pubkey) {
    throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
  }
  if (params.commonKeychain && signingKeychain.commonKeychain !== params.commonKeychain) {
    throw new Error(
      `Common keychain provided does not match the keychain on wallet for ${params.source}`,
    );
  }

  try {
    const prebuildParams: PrebuildTransactionOptions = {
      ...params,
      // Convert memo string to Memo object if present
      memo: params.memo ? ({ type: 'text', value: params.memo } as Memo) : undefined,
    };

    // First build the transaction with bitgo
    const txPrebuilt = await wallet.prebuildTransaction({
      ...prebuildParams,
      reqId,
    });

    logger.debug('Tx prebuild: %s', JSON.stringify(txPrebuilt, null, 2));

    // verify transaction prebuild
    try {
      const verified = await baseCoin.verifyTransaction({
        txParams: { ...prebuildParams },
        txPrebuild: txPrebuilt,
        wallet,
        verification: {},
        reqId: reqId,
        walletType: wallet.multisigType(),
      });
      if (!verified) {
        throw new Error('Transaction prebuild failed local validation');
      }
      logger.debug('Transaction prebuild verified');
    } catch (e) {
      const err = e as Error;
      logger.error('transaction prebuild failed local validation:', err.message);
      logger.error('transaction prebuild:', JSON.stringify(txPrebuilt, null, 2));
      throw new Error(`Transaction prebuild failed local validation: ${err.message}`);
    }

    logger.debug('Tx prebuild: %s', JSON.stringify(txPrebuilt, null, 2));

    // Need to branch off for multisig and tss
    if (wallet.multisigType() === 'tss') {
      if (!txPrebuilt.txRequestId) {
        throw new Error('MPC tx not built correctly.');
      }
      return signAndSendTxRequests(
        bitgo,
        wallet,
        txPrebuilt.txRequestId,
        enclavedExpressClient,
        signingKeychain,
        reqId,
      );
    } else {
      return signAndSendMultisig(
        wallet,
        req.decoded.source,
        txPrebuilt,
        prebuildParams,
        enclavedExpressClient,
        signingKeychain,
        reqId,
      );
    }
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to send many: %s', err.message);
    throw err;
  }
}

async function signAndSendMultisig(
  wallet: Wallet,
  source: 'user' | 'backup',
  txPrebuilt: PrebuildTransactionResult,
  params: SendManyOptions,
  enclavedExpressClient: EnclavedExpressClient,
  signingKeychain: Keychain,
  reqId: RequestTracer,
) {
  if (!signingKeychain.pub) {
    throw new Error(`Signing keychain pub not found for ${source}`);
  }
  logger.info(`Signing with ${source} keychain, pub: ${signingKeychain.pub}`);
  logger.debug(`Signing keychain: ${JSON.stringify(signingKeychain, null, 2)}`);

  // Then sign it using the enclaved express client
  const signedTx = await enclavedExpressClient.signMultisig({
    txPrebuild: txPrebuilt,
    source: source,
    pub: signingKeychain.pub,
  });

  // Get extra prebuild parameters
  const extraParams = await wallet.baseCoin.getExtraPrebuildParams({
    ...params,
    wallet,
  });

  // Combine the signed transaction with extra parameters
  const finalTxParams = { ...signedTx, ...extraParams };

  // Submit the half signed transaction
  const result = (await wallet.submitTransaction(finalTxParams, reqId)) as any;
  return result;
}

/**
 * Signs and sends a transaction from a TSS wallet.
 *
 * @param bitgo - BitGo instance
 * @param wallet - Wallet instance
 * @param txRequestId - Transaction request ID
 * @param enclavedExpressClient - Enclaved express client
 * @param signingKeychain - Signing keychain
 * @param reqId - Request tracer
 */
async function signAndSendTxRequests(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequestId: string,
  enclavedExpressClient: EnclavedExpressClient,
  signingKeychain: Keychain,
  reqId: RequestTracer,
): Promise<any> {
  if (!signingKeychain.commonKeychain) {
    throw new Error(`Common keychain not found for keychain ${signingKeychain.pub || 'unknown'}`);
  }
  if (signingKeychain.source === 'backup') {
    throw new Error('Backup MPC signing not supported for sendMany');
  }

  let signedTxRequest: TxRequest;
  const mpcAlgorithm = wallet.baseCoin.getMPCAlgorithm();

  if (mpcAlgorithm === 'eddsa') {
    signedTxRequest = await handleEddsaSigning(
      bitgo,
      wallet,
      txRequestId,
      enclavedExpressClient,
      signingKeychain.commonKeychain,
      reqId,
    );
  } else if (mpcAlgorithm === 'ecdsa') {
    signedTxRequest = await handleEcdsaSigning(
      bitgo,
      wallet,
      txRequestId,
      enclavedExpressClient,
      signingKeychain.source as 'user' | 'backup',
      signingKeychain.commonKeychain,
      reqId,
    );
  } else {
    throw new Error(`Unsupported MPC algorithm: ${mpcAlgorithm}`);
  }

  if (!signedTxRequest.txRequestId) {
    throw new Error('txRequestId missing from signed transaction');
  }

  if (signedTxRequest.apiVersion !== 'full') {
    throw new Error('Only TxRequest API version full is supported.');
  }

  bitgo.setRequestTracer(reqId);
  if (signedTxRequest.state === 'pendingApproval') {
    const pendingApprovals = new PendingApprovals(bitgo, wallet.baseCoin);
    const pendingApproval = await pendingApprovals.get({ id: signedTxRequest.pendingApprovalId });
    return {
      pendingApproval: pendingApproval.toJSON(),
      txRequest: signedTxRequest,
    };
  }
  return {
    txRequest: signedTxRequest,
    txid: (signedTxRequest.transactions ?? [])[0]?.signedTx?.id,
    tx: (signedTxRequest.transactions ?? [])[0]?.signedTx?.tx,
  };
}
