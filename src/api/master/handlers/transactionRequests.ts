import {
  BitGoBase,
  Keychain,
  PendingApprovals,
  RequestTracer,
  TxRequest,
  Wallet,
} from '@bitgo-beta/sdk-core';
import { AdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';
import { handleEddsaSigning } from './eddsa';
import { signAndSendEcdsaMPCv2FromTxRequest } from './ecdsaMPCv2';

/**
 * Signs and sends a transaction from a TSS wallet.
 *
 * @param bitgo - BitGo instance
 * @param wallet - Wallet instance
 * @param txRequestId - Transaction request ID
 * @param awmClient - Advanced Wallet Manager client
 * @param signingKeychain - Signing keychain
 * @param reqId - Request tracer
 */
export async function signAndSendTxRequests(
  bitgo: BitGoBase,
  wallet: Wallet,
  txRequest: TxRequest,
  awmClient: AdvancedWalletManagerClient,
  signingKeychain: Keychain,
  reqId: RequestTracer,
): Promise<any> {
  if (!signingKeychain.commonKeychain) {
    throw new Error(`Common keychain not found for keychain ${signingKeychain.pub || 'unknown'}`);
  }

  let signedTxRequest: TxRequest;
  const mpcAlgorithm = wallet.baseCoin.getMPCAlgorithm();

  if (mpcAlgorithm === 'eddsa') {
    signedTxRequest = await handleEddsaSigning(
      bitgo,
      wallet,
      txRequest,
      awmClient,
      signingKeychain.commonKeychain,
      reqId,
    );
  } else if (mpcAlgorithm === 'ecdsa') {
    signedTxRequest = await signAndSendEcdsaMPCv2FromTxRequest(
      bitgo,
      wallet,
      txRequest,
      awmClient,
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
