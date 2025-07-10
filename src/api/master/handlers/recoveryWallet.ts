import { BaseCoin, BitGoAPI, MethodNotImplementedError } from 'bitgo';

import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import { AbstractUtxoCoin } from '@bitgo/abstract-utxo';

import assert from 'assert';

import {
  isEddsaCoin,
  isEthLikeCoin,
  isFormattedOfflineVaultTxInfo,
  isUtxoCoin,
} from '../../../shared/coinUtils';
import {
  DEFAULT_MUSIG_ETH_GAS_PARAMS,
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
  coinSpecificParams?: Record<string, undefined>;
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

  logger.info('UTXO recovery transaction created:', recoverTx);
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
  const { recoveryDestinationAddress, coinSpecificParams } = req.decoded;

  const sdkCoin = bitgo.coin(coin);

  // Handle TSS recovery
  if (req.decoded.isTssRecovery) {
    assert(req.decoded.tssRecoveryParams, 'TSS recovery parameters are required');
    const { commonKeychain } = req.decoded.tssRecoveryParams;
    if (!commonKeychain) {
      throw new Error('Common keychain is required for TSS recovery');
    }

    if (isEddsaCoin(sdkCoin)) {
      return handleEddsaRecovery(
        req.bitgo,
        sdkCoin,
        {
          userKey: commonKeychain,
          backupKey: commonKeychain,
          walletContractAddress: '',
          recoveryDestination: recoveryDestinationAddress,
          apiKey: req.decoded.apiKey || '',
        },
        enclavedExpressClient,
        {
          userPub: commonKeychain,
          backupPub: commonKeychain,
          apiKey: '',
          walletContractAddress: '',
          unsignedSweepPrebuildTx: undefined,
          coinSpecificParams: undefined,
        },
      );
    } else {
      throw new MethodNotImplementedError(
        `TSS recovery is not implemented for coin: ${coin}. Supported coins are Eddsa coins.`,
      );
    }
  }

  // Handle standard recovery
  if (!req.decoded.multiSigRecoveryParams) {
    throw new Error('MultiSig recovery parameters are required for standard recovery');
  }

  const { userPub, backupPub, bitgoPub, walletContractAddress } =
    req.decoded.multiSigRecoveryParams;
  const apiKey = req.decoded.apiKey || '';

  if (!userPub || !backupPub) {
    throw new Error('Missing required fields for standard recovery');
  }

  // Check if the public key is valid
  if (!sdkCoin.isValidPub(userPub)) {
    throw new Error('Invalid user public key format');
  } else if (!sdkCoin.isValidPub(backupPub)) {
    throw new Error('Invalid backup public key format');
  }

  const commonRecoveryParams: RecoveryParams = {
    userKey: userPub,
    backupKey: backupPub,
    walletContractAddress,
    recoveryDestination: recoveryDestinationAddress,
    apiKey,
  };

  if (isEthLikeCoin(sdkCoin)) {
    if (!walletContractAddress) {
      throw new Error('Missing walletContract address');
    }
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
