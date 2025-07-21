import { type Recipient, type SignedTransaction } from '@bitgo-beta/sdk-core';

export type SignedEthLikeRecoveryTx = SignedTransaction & {
  signatures?: string;
  halfSigned?: {
    signatures?: string;
    recipients?: Recipient[];
    signingKeyNonce?: number;
    backupKeyNonce?: number;
    expireTime?: number;
    txHex?: string;
  };
  replayProtectionOptions?: ReplayProtectionOptions;
  recipients?: Recipient[];
  isFullSigned?: boolean;
  isHalfSigned?: boolean;
  backupKeyNonce?: number;
  walletContractAddress?: string;
  amount?: string;
  isEvmBasedCrossChainRecovery?: boolean;
  feesUsed?: {
    gasPrice: number;
    gasLimit: number;
  };
  gasLimit?: number;
  coin?: string;
  gasPrice?: number;
  feeInfo?: any;
  eip1559?: any;
};

export type ReplayProtectionOptions = {
  chain: number; // 1 if mainnet, 17000 if testnet
  hardfork: string;
};
