import { type EnvironmentName } from '../shared/types/index';
import type { ReplayProtectionOptions, SignedEthLikeRecoveryTx } from '../types/transaction';

export function addEthLikeRecoveryExtras({
  env,
  signedTx,
  transaction,
  isLastSignature,
  replayProtectionOptions,
}: {
  env: EnvironmentName;
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
    decoratedSignedTx.replayProtectionOptions = getReplayProtectionOptions(
      env,
      replayProtectionOptions,
    );
  }

  return decoratedSignedTx;
}

export function getReplayProtectionOptions(
  env: EnvironmentName,
  replayProtectionOptions: ReplayProtectionOptions | undefined = undefined,
): ReplayProtectionOptions {
  return (
    replayProtectionOptions ?? {
      chain: env === 'prod' ? 1 : 560048,
      hardfork: 'london',
    }
  );
}

export const DEFAULT_MUSIG_ETH_GAS_PARAMS = {
  gasPrice: 20000000000,
  gasLimit: 200000,
  maxFeePerGas: 20000000000,
  maxPriorityFeePerGas: 10000000000,
};
