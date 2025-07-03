import { BaseCoin, MethodNotImplementedError } from 'bitgo';

import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import { AbstractUtxoCoin } from '@bitgo/abstract-utxo';

import { Sol } from 'bitgo/dist/types/src/v2/coins';
import {
  isEthLikeCoin,
  isFormattedOfflineVaultTxInfo,
  isSolCoin,
  isUtxoCoin,
} from '../../../shared/coinUtils';
import {
  getDefaultMusigEthGasParams,
  getReplayProtectionOptions,
} from '../../../shared/recoveryUtils';
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
) {
  try {
    const { gasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas } =
      getDefaultMusigEthGasParams();
    const unsignedSweepPrebuildTx = await (sdkCoin as AbstractEthLikeNewCoins).recover({
      ...commonRecoveryParams,
      gasPrice,
      gasLimit,
      eip1559: {
        maxFeePerGas,
        maxPriorityFeePerGas,
      },
      replayProtectionOptions: getReplayProtectionOptions(),
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

function getKeyNonceFromParams(
  coinSpecificParams: EnclavedRecoveryParams['coinSpecificParams'] | undefined,
) {
  // formatted as in WRW
  if (!coinSpecificParams) return undefined;

  const { publicKeyNonce, secretKeyNonce } = coinSpecificParams;
  if (!publicKeyNonce || !secretKeyNonce) return undefined;

  // coinSpecificParams is untyped so we need to cast the keys in order to avoid build errors.
  return { publicKey: publicKeyNonce as string, secretKey: secretKeyNonce as string };
}

async function handleSolRecovery(
  sdkCoin: Sol,
  commonRecoveryParams: RecoveryParams,
  enclavedExpressClient: EnclavedExpressClient,
  params: EnclavedRecoveryParams,
) {
  const { recoveryDestination, userKey } = commonRecoveryParams;
  try {
    const durableNonce = getKeyNonceFromParams(params.coinSpecificParams);
    const { seed } = params.coinSpecificParams;
    const unsignedSweepPrebuildTx = await sdkCoin.recover({
      bitgoKey: userKey,
      userKey: '', // as in the WRW
      backupKey: '', // as in the WRW
      // ignoreAddressTypes: [], // TODO: notify eth-alt, this one is on the WRW call but not even compatible with sdk recover call
      seed,
      durableNonce,
      recoveryDestination: recoveryDestination,
    });

    console.log('Unsigned sweep tx');
    console.log(JSON.stringify(unsignedSweepPrebuildTx, null, 2));
    // TODO: implement recoveryMPC on ebe
    const fullSignedRecoveryTx = await enclavedExpressClient.recoveryMPC({
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

  if (isTSS(sdkCoin)) {
    if (isSolCoin(sdkCoin)) {
      handleSolRecovery(sdkCoin, commonRecoveryParams, enclavedExpressClient, {
        userPub,
        backupPub,
        unsignedSweepPrebuildTx: undefined,
        apiKey,
        walletContractAddress,
        coinSpecificParams: {
          publicKeyNonce: coinSpecificParams?.publicKeyNonce,
          secretKeyNonce: coinSpecificParams?.secretKeyNonce,
          seed: coinSpecificParams?.seed,
        },
      });
    }
  }

  if (isEthLikeCoin(sdkCoin)) {
    return handleEthLikeRecovery(sdkCoin, commonRecoveryParams, enclavedExpressClient, {
      userPub,
      backupPub,
      apiKey,
      unsignedSweepPrebuildTx: undefined,
      coinSpecificParams: undefined,
      walletContractAddress,
    });
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

function isTSS(coin: BaseCoin): boolean {
  // ETH could be TSS or Musig, how do we differenciate. Update: we discussed this with Mohammad but didn't had time to implement it
  // so i'm just faking the eval return
  console.log(coin);
  return true;
}
