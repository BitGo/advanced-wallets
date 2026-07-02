import { SignedTransaction } from '@bitgo-beta/sdk-core';
import { AsyncJobResponse } from '../../clients/bridgeClient.types';
import { RecoveryMultisigUnsignedSweepTx } from '../../clients/advancedWalletManagerClient';
import { KeySource, MasterExpressConfig, UserOrBackupKey } from '../../../shared/types';
import { BitGoRequest } from '../../../types/request';
import { submitJobViaBridgeClient } from './asyncUtils';
import { parseSignedMultisigTransaction } from './multisigSignUtils';

/** Bridge body for a `multisig_recovery` job — what would be sent to AWM. */
export type MultisigRecoveryBody = {
  userPub: string;
  backupPub: string;
  bitgoPub?: string;
  unsignedSweepPrebuildTx: RecoveryMultisigUnsignedSweepTx;
  walletContractAddress: string;
};

/** Submits a recovery job to the bridge, or returns null when async mode is off. */
export async function submitMultisigRecoveryJob(
  req: BitGoRequest<MasterExpressConfig>,
  coin: string,
  body: MultisigRecoveryBody,
  sources: UserOrBackupKey[] = [KeySource.USER],
): Promise<AsyncJobResponse | null> {
  return submitJobViaBridgeClient(req, {
    path: `/api/${coin}/multisig/recovery`,
    body,
    sources,
    operationType: 'multisig_recovery',
  });
}

export function parseSignedRecoveryTransaction(body: unknown): SignedTransaction {
  return parseSignedMultisigTransaction(body);
}
