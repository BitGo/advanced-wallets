import { BaseCoin, MethodNotImplementedError } from 'bitgo';

import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import { AbstractUtxoCoin } from '@bitgo/abstract-utxo';

import {
  isEthLikeCoin,
  isFormattedOfflineVaultTxInfo,
  isUtxoCoin,
} from '../../../shared/coinUtils';
import {
  DEFAULT_MUSIG_ETH_GAS_PARAMS,
  getReplayProtectionOptions,
} from '../../../shared/recoveryUtils';
import { EnvironmentName } from '../../../shared/types/index';
import { EnclavedExpressClient } from '../clients/enclavedExpressClient';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';

interface RecoveryParams {
  userKey: string;
  backupKey: string;
  walletContractAddress: string;
  recoveryDestination: string;
  apiKey: string;
}

interface EnclavedRecoveryParams {
  userPub: string;
  backupPub: string;
  apiKey: string;
  unsignedSweepPrebuildTx: any; // TODO: type this properly once we have the SDK types
  coinSpecificParams: any;
  walletContractAddress: string;
}

async function handleEthLikeRecovery(
  sdkCoin: BaseCoin,
  commonRecoveryParams: RecoveryParams,
  enclavedExpressClient: any,
  params: EnclavedRecoveryParams,
  env: EnvironmentName,
) {
  try {
    const { gasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas } = DEFAULT_MUSIG_ETH_GAS_PARAMS;
    const unsignedSweepPrebuildTx = await (sdkCoin as AbstractEthLikeNewCoins).recover({
      ...commonRecoveryParams,
      gasPrice,
      gasLimit,
      eip1559: {
        maxFeePerGas,
        maxPriorityFeePerGas,
      },
      replayProtectionOptions: getReplayProtectionOptions(env),
    });

    const fullSignedRecoveryTx = await enclavedExpressClient.recoveryMultisig({
      ...params,
      unsignedSweepPrebuildTx,
    });

    return fullSignedRecoveryTx;
  } catch (err) {
    throw err;
  }
}

export type UtxoCoinSpecificRecoveryParams = Pick<
  Parameters<AbstractUtxoCoin['recover']>[0],
  | 'apiKey'
  | 'userKey'
  | 'backupKey'
  | 'bitgoKey'
  | 'ignoreAddressTypes'
  | 'scan'
  | 'feeRate'
  | 'recoveryDestination'
>;

async function handleUtxoLikeRecovery(
  sdkCoin: BaseCoin,
  enclavedClient: EnclavedExpressClient,
  recoveryParams: UtxoCoinSpecificRecoveryParams,
): Promise<{ txHex: string }> {
  const abstractUtxoCoin = sdkCoin as unknown as AbstractUtxoCoin;
  const recoverTx = await abstractUtxoCoin.recover(recoveryParams);

  console.log('UTXO recovery transaction created:', recoverTx);
  if (!isFormattedOfflineVaultTxInfo(recoverTx)) {
    throw new MethodNotImplementedError(`Unknown transaction ${JSON.stringify(recoverTx)} created`);
  }

  return (await enclavedClient.recoveryMultisig({
    userPub: recoveryParams.userKey,
    backupPub: recoveryParams.backupKey,
    bitgoPub: recoveryParams.bitgoKey,
    unsignedSweepPrebuildTx: recoverTx,
    walletContractAddress: '',
  })) as { txHex: string };
}

export async function handleRecoveryWalletOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.recovery', 'post'>,
) {
  const bitgo = req.bitgo;
  const coin = req.decoded.coin;
  const enclavedExpressClient = req.enclavedExpressClient;

  const {
    userPub,
    backupPub,
    bitgoPub,
    walletContractAddress,
    recoveryDestinationAddress,
    coinSpecificParams,
    apiKey,
  } = req.decoded;

  //construct a common payload for the recovery that it's repeated in any kind of recovery
  const commonRecoveryParams: RecoveryParams = {
    userKey: userPub,
    backupKey: backupPub,
    walletContractAddress,
    recoveryDestination: recoveryDestinationAddress,
    apiKey,
  };

  const sdkCoin = bitgo.coin(coin);

  // Check if the public key is valid
  if (!sdkCoin.isValidPub(userPub)) {
    throw new Error('Invalid user public key format');
  } else if (!sdkCoin.isValidPub(backupPub)) {
    throw new Error('Invalid backup public');
  }

  if (isEthLikeCoin(sdkCoin)) {
    return handleEthLikeRecovery(
      sdkCoin,
      commonRecoveryParams,
      enclavedExpressClient,
      {
        userPub,
        backupPub,
        apiKey,
        unsignedSweepPrebuildTx: undefined,
        coinSpecificParams: undefined,
        walletContractAddress,
      },
      bitgo.env as EnvironmentName,
    );
  }
  if (!bitgoPub) {
    throw new Error('BitGo public key is required for recovery');
  }

  if (isUtxoCoin(sdkCoin)) {
    return handleUtxoLikeRecovery(sdkCoin, req.enclavedExpressClient, {
      userKey: userPub,
      backupKey: backupPub,
      bitgoKey: bitgoPub,
      ignoreAddressTypes: coinSpecificParams?.ignoreAddressTypes ?? [],
      scan: coinSpecificParams?.addressScan,
      feeRate: coinSpecificParams?.feeRate,
      recoveryDestination: recoveryDestinationAddress,
      apiKey,
    });
  }

  throw new MethodNotImplementedError('Recovery wallet is not supported for this coin: ' + coin);
}
