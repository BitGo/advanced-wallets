import assert from 'assert';
import { isMasterExpressConfig } from '../types';
import { createEnclavedExpressClient } from './enclavedExpressClient';
import { MasterApiSpecRouteRequest } from './routers/masterApiSpec';

export async function handleRecoveryWalletOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.recovery', 'post'>,
) {
  const coin = req.params.coin;
  assert(
    isMasterExpressConfig(req.config),
    'Expected req.config to be of type MasterExpressConfig',
  );
  const enclavedExpressClient = createEnclavedExpressClient(req.config, coin);
  if (!enclavedExpressClient) {
    throw new Error(
      'Enclaved express client not configured - enclaved express features will be disabled',
    );
  }

  const {
    userPub,
    backupPub,
    walletContractAddress,
    recoveryDestinationAddress,
    recoveryParams,
    apiKey,
  } = req.body;

  try {
    const fullSignedRecoveryTx = await enclavedExpressClient.recoveryMultisig({
      userPub,
      backupPub,
      walletContractAddress,
      recoveryDestinationAddress,
      apiKey,
      recoveryParams,
    });

    return fullSignedRecoveryTx;
  } catch (err) {
    //TODO: check other error handling for ref on mbe
    throw err;
  }
}
