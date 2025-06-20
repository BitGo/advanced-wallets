import { MethodNotImplementedError } from 'bitgo';
import { isEthLikeCoin } from '../../../shared/coinUtils';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';

export async function handleRecoveryWalletOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.recovery', 'post'>,
) {
  const bitgo = req.bitgo;
  const coin = req.decoded.coin;
  const enclavedExpressClient = req.enclavedExpressClient;

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
      });

      return fullSignedRecoveryTx;
    } catch (err) {
      throw err;
    }
  } else {
    throw new MethodNotImplementedError('Recovery wallet is not supported for this coin: ' + coin);
  }
}
