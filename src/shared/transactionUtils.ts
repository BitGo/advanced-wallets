/**
 * Utility functions for transaction type checking and processing
 */
import {
  type MPCSweepTxs,
  type MPCTx,
  type MPCTxs,
  type MPCUnsignedTx,
  type RecoveryTxRequest,
} from '@bitgo-beta/sdk-core';

/**
 * Type guard to check if the object is an MPCTxs format
 * MPCTxs format has a txRequests array containing transaction information
 */
export function isMPCTxs(tx: any): tx is MPCTxs {
  return (
    tx &&
    'transactions' in tx &&
    Array.isArray(tx.transactions) &&
    tx.transactions.length > 0 &&
    isMPCTx(tx.transactions[0])
  );
}

/**
 * Type guard to check if the object is an MPCTx format
 * MPCTx format has direct signableHex and derivationPath properties
 */
export function isMPCTx(tx: any): tx is MPCTx {
  return tx && 'signableHex' in tx;
}

/**
 * Type guard to check if the object is an MPCSweepTxs format
 * MPCSweepTxs is an array of objects with transactions property
 */
export function isMPCSweepTxs(tx: any): tx is MPCSweepTxs {
  return (
    'txRequests' in tx &&
    Array.isArray(tx.txRequests) &&
    tx.txRequests.length > 0 &&
    tx.txRequests[0] &&
    isRecoveryTxRequest(tx.txRequests[0])
  );
}

export function isRecoveryTxRequest(tx: any): tx is RecoveryTxRequest {
  return (
    'walletCoin' in tx &&
    'transactions' in tx &&
    Array.isArray(tx.transactions) &&
    tx.transactions.length > 0 &&
    tx.transactions[0] &&
    isMPCUnsignedTx(tx.transactions[0])
  );
}

export function isMPCUnsignedTx(tx: any): tx is MPCUnsignedTx {
  return 'unsignedTx' in tx && isMPCTx(tx.unsignedTx);
}
/**
 * Extracts transaction request information from various transaction formats
 * @param tx The transaction object in one of the supported formats
 * @returns Object with signableHex and derivationPath extracted from the transaction
 */
export function extractTransactionRequestInfo(
  tx: MPCTx | MPCSweepTxs | MPCTxs | RecoveryTxRequest,
): {
  signableHex: string;
  derivationPath: string;
} {
  const txRequest = {
    signableHex: '',
    derivationPath: '',
  };

  if (isMPCTxs(tx)) {
    const transaction = tx.transactions[0];
    txRequest.signableHex = transaction.signableHex || '';
    txRequest.derivationPath = transaction.derivationPath || '';
  } else if (isMPCTx(tx)) {
    txRequest.signableHex = tx.signableHex || '';
    txRequest.derivationPath = tx.derivationPath || '';
  } else if (isMPCSweepTxs(tx)) {
    const firstRequest = tx.txRequests[0];
    if (firstRequest && firstRequest.transactions && firstRequest.transactions[0]) {
      const firstTx = firstRequest.transactions[0];
      txRequest.signableHex = firstTx.unsignedTx?.serializedTx || '';
      txRequest.derivationPath = firstTx.unsignedTx?.derivationPath || '';
    }
  } else if (isRecoveryTxRequest(tx)) {
    const firstTransaction = tx.transactions[0];
    txRequest.signableHex = firstTransaction.unsignedTx?.serializedTx || '';
    txRequest.derivationPath = firstTransaction.unsignedTx?.derivationPath || '';
  } else {
    throw new Error(`Unrecognized transaction ${JSON.stringify(tx)}`);
  }

  return txRequest;
}
