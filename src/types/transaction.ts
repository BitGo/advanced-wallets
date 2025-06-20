import { type Recipient, type SignedTransaction } from 'bitgo';

export type HalfSignedEthLikeRecoveryTx = SignedTransaction & {
  halfSigned: {
    signatures?: string;
    recipients?: Recipient[];
    signingKeyNonce?: number;
    backupKeyNonce?: number;
  };
};
