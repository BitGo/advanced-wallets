import assert from 'assert';
import { MethodNotImplementedError } from 'bitgo';
import { isEthLikeCoin } from '../shared/coinUtils';
import { isMasterExpressConfig } from '../types';
import { createEnclavedExpressClient } from './enclavedExpressClient';
import { MasterApiSpecRouteRequest } from './routers/masterApiSpec';

export async function handleRecoveryWalletOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.recovery', 'post'>,
) {
  const bitgo = req.bitgo;
  const coin = req.decoded.coin;
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
    coinSpecificParams,
    apiKey,
  } = req.decoded;

  //construct a common payload for the recovery that it's repeated in any kind of recovery
  const commonRecoveryParams = {
    userKey: userPub,
    backupKey: backupPub,
    walletContractAddress,
    recoveryDestination: recoveryDestinationAddress,
    apiKey,
  };

  const sdkCoin = bitgo.coin(coin);

  if (isEthLikeCoin(sdkCoin)) {
    try {
      const unsignedSweepPrebuildTx = await sdkCoin.recover({
        ...commonRecoveryParams,
      });
      const fullSignedRecoveryTx = await enclavedExpressClient.recoveryMultisig({
        userPub,
        backupPub,
        apiKey,
        unsignedSweepPrebuildTx,
        coinSpecificParams,
        walletContractAddress,
        // recoveryDestinationAddress,
      });

      return fullSignedRecoveryTx;
    } catch (err) {
      throw err;
    }
  } else {
    throw new MethodNotImplementedError('Recovery wallet is not supported for this coin: ' + coin);
  }
}
