import type { ReplayProtectionOptions, SignedEthLikeRecoveryTx } from '../types/transaction';

export function addEthLikeRecoveryExtras({
  signedTx,
  transaction,
  isLastSignature,
  replayProtectionOptions,
}: {
  signedTx: SignedEthLikeRecoveryTx;
  transaction: any; // Same type as UnsignedSweepPrebuildTx
  isLastSignature: boolean;
  replayProtectionOptions: ReplayProtectionOptions | undefined;
}) {
  const decoratedSignedTx = { ...signedTx };
  if (signedTx.signatures) {
    decoratedSignedTx.isFullSigned = true;
  }
  if (transaction.feeInfo) {
    decoratedSignedTx.feeInfo = transaction.feeInfo;
  }
  if (transaction.coin) {
    decoratedSignedTx.coin = transaction.coin;
  }
  if (transaction.gasPrice) {
    decoratedSignedTx.gasPrice = transaction.gasPrice;
  }
  if (transaction.gasLimit) {
    decoratedSignedTx.gasLimit = transaction.gasLimit;
  }

  if (transaction.eip1559) {
    decoratedSignedTx.eip1559 = transaction.eip1559;
  }
  if (transaction.gasPrice && transaction.gasLimit) {
    decoratedSignedTx.feesUsed = {
      gasPrice: transaction.gasPrice,
      gasLimit: transaction.gasLimit,
    };
  }
  if (transaction.isEvmBasedCrossChainRecovery) {
    decoratedSignedTx.isEvmBasedCrossChainRecovery = transaction.isEvmBasedCrossChainRecovery;
  }
  if (transaction.amount) {
    decoratedSignedTx.amount = transaction.amount;
  }
  if (!isLastSignature) {
    decoratedSignedTx.isHalfSigned = true;
    decoratedSignedTx.backupKeyNonce =
      'backupKeyNonce' in transaction
        ? transaction.backupKeyNonce
        : transaction.nextContractSequenceId;
    decoratedSignedTx.walletContractAddress = transaction.walletContractAddress;
    decoratedSignedTx.replayProtectionOptions = getReplayProtectionOptions(replayProtectionOptions);
  }

  return decoratedSignedTx;
}

export function getReplayProtectionOptions(
  replayProtectionOptions: ReplayProtectionOptions | undefined = undefined,
): ReplayProtectionOptions {
  return (
    replayProtectionOptions ?? {
      chain: 17000, // 1 if mainnet, 17000 if testnet
      hardfork: 'london',
    }
  );
}

export function getDefaultMusigEthGasParams() {
  return {
    gasPrice: 20000000000,
    gasLimit: 200000,
    maxFeePerGas: 20000000000,
    maxPriorityFeePerGas: 10000000000,
  };
}
