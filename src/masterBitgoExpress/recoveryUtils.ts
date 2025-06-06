import { RecoverOptions } from '@bitgo/abstract-eth';
import { BitGoRequest } from '../types/request';

export function parseRecoveryWalletParams(req: BitGoRequest): RecoverOptions & { apiKey: string } {
  const { userKey, backupKey, walletContractAddress, recoveryDestination, apiKey } = req.body;
  return { userKey, backupKey, walletContractAddress, recoveryDestination, apiKey };
}
