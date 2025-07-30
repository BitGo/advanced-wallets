import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { BaseCoin, MethodNotImplementedError, MPCRecoveryOptions } from '@bitgo-beta/sdk-core';
import { AbstractEthLikeNewCoins } from '@bitgo-beta/abstract-eth';
import { AbstractUtxoCoin } from '@bitgo-beta/abstract-utxo';
import { type SolRecoveryOptions } from '@bitgo-beta/sdk-coin-sol';
import coinFactory from '../../../shared/coinFactory';

import assert from 'assert';

import {
  isCosmosLikeCoin,
  isEcdsaCoin,
  isEddsaCoin,
  isEthLikeCoin,
  isFormattedOfflineVaultTxInfo,
  isUtxoCoin,
} from '../../../shared/coinUtils';
import {
  DEFAULT_MUSIG_ETH_GAS_PARAMS,
  getReplayProtectionOptions,
} from '../../../shared/recoveryUtils';

import { AdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';
import {
  CoinSpecificParams,
  CoinSpecificParamsUnion,
  MasterApiSpecRouteRequest,
  ScriptType2Of3,
  SolanaRecoveryOptions,
} from '../routers/masterApiSpec';
import { recoverEddsaWallets } from './recoverEddsaWallets';
import { EnvironmentName, MasterExpressConfig } from '../../../shared/types';
import { recoverEcdsaMpcV2Params, recoverEcdsaMPCv2Wallets } from './recoverEcdsaWallets';
import logger from '../../../logger';
import { NotImplementedError, ValidationError } from '../../../shared/errors';
import { CoinFamily } from '@bitgo-beta/statics';
import { checkRecoveryMode } from '../handlerUtils';

interface RecoveryParams {
  userKey: string;
  backupKey: string;
  walletContractAddress: string;
  recoveryDestination: string;
  apiKey: string;
}

interface AwmRecoveryParams {
  userPub: string;
  backupPub: string;
  apiKey: string;
  unsignedSweepPrebuildTx: any; // TODO: type this properly once we have the SDK types
  coinSpecificParams?: CoinSpecificParamsUnion;
  walletContractAddress: string;
}

function validateRecoveryParams(
  sdkCoin: BaseCoin,
  params?: CoinSpecificParams,
  isMpcRecovery = false,
) {
  if (!params) {
    return;
  }

  if (isUtxoCoin(sdkCoin)) {
    // UTXO coins need utxoRecoveryOptions for standard recovery
    if (!isMpcRecovery && !params.utxoRecoveryOptions) {
      throw new ValidationError('UTXO recovery options are required for UTXO coin recovery');
    }
    return;
  }

  if (isEddsaCoin(sdkCoin)) {
    // EdDSA coins (like Solana) need solanaRecoveryOptions for standard recovery
    if (!params.solanaRecoveryOptions) {
      throw new ValidationError('Solana recovery options are required for EdDSA coin recovery');
    }
    return;
  }

  if (isEcdsaCoin(sdkCoin) && isMpcRecovery) {
    if (isEthLikeCoin(sdkCoin)) {
      if (!params.ecdsaEthLikeRecoverySpecificParams) {
        throw new ValidationError(
          'ECDSA ETH-like recovery specific parameters are required for MPC recovery',
        );
      }
    } else if (isCosmosLikeCoin(sdkCoin)) {
      // ECDSA Cosmos-like MPC recovery needs ecdsaCosmosLikeRecoverySpecificParams
      if (!params.ecdsaCosmosLikeRecoverySpecificParams) {
        throw new ValidationError(
          'ECDSA Cosmos-like recovery specific parameters are required for MPC recovery',
        );
      }
    } else {
      throw new NotImplementedError(
        `MPC V2 recovery is not supported for coin family: ${sdkCoin.getFamily()}`,
      );
    }
  }
  if (!isMpcRecovery && isEthLikeCoin(sdkCoin)) {
    // Non-ECDSA ETH-like coins need evmRecoveryOptions for standard recovery
    if (!params.evmRecoveryOptions) {
      throw new ValidationError('EVM recovery options are required for ETH-like coin recovery');
    }
    return;
  }
}

async function handleEthLikeRecovery(
  sdkCoin: BaseCoin,
  commonRecoveryParams: RecoveryParams,
  advancedWalletManagerClient: any,
  params: AwmRecoveryParams,
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
      apiKey: params.apiKey,
      isUnsignedSweep: true,
    });

    return await advancedWalletManagerClient.recoveryMultisig({
      ...params,
      unsignedSweepPrebuildTx,
    });
  } catch (err) {
    throw err;
  }
}

async function handleEddsaRecovery(
  bitgo: BitGoAPI,
  sdkCoin: BaseCoin,
  commonRecoveryParams: RecoveryParams,
  advancedWalletManagerClient: AdvancedWalletManagerClient,
  params: AwmRecoveryParams,
) {
  const { recoveryDestination, userKey } = commonRecoveryParams;
  try {
    const options: MPCRecoveryOptions = {
      bitgoKey: userKey,
      recoveryDestination,
      apiKey: params.apiKey,
    };
    let unsignedSweepPrebuildTx: Awaited<ReturnType<typeof recoverEddsaWallets>>;
    if (sdkCoin.getFamily() === CoinFamily.SOL) {
      const solanaParams = params.coinSpecificParams as SolanaRecoveryOptions;
      const solanaRecoveryOptions: SolRecoveryOptions = { ...options };
      solanaRecoveryOptions.recoveryDestinationAtaAddress =
        solanaParams.recoveryDestinationAtaAddress;
      solanaRecoveryOptions.closeAtaAddress = solanaParams.closeAtaAddress;
      solanaRecoveryOptions.tokenContractAddress = solanaParams.tokenContractAddress;
      solanaRecoveryOptions.programId = solanaParams.programId;
      if (solanaParams.durableNonce) {
        solanaRecoveryOptions.durableNonce = {
          publicKey: solanaParams.durableNonce.publicKey,
          secretKey: solanaParams.durableNonce.secretKey,
        };
      }
      unsignedSweepPrebuildTx = await recoverEddsaWallets(bitgo, sdkCoin, solanaRecoveryOptions);
    } else {
      unsignedSweepPrebuildTx = await recoverEddsaWallets(bitgo, sdkCoin, options);
    }
    logger.info('Unsigned sweep tx: ', JSON.stringify(unsignedSweepPrebuildTx, null, 2));

    return await advancedWalletManagerClient.recoveryMPC({
      userPub: params.userPub,
      backupPub: params.backupPub,
      apiKey: params.apiKey,
      unsignedSweepPrebuildTx,
      coinSpecificParams: params.coinSpecificParams,
      walletContractAddress: params.walletContractAddress,
    });
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
  advancedWalletManagerClient: AdvancedWalletManagerClient,
  recoveryParams: UtxoCoinSpecificRecoveryParams,
): Promise<{ txHex: string }> {
  const abstractUtxoCoin = sdkCoin as unknown as AbstractUtxoCoin;
  const recoverTx = await abstractUtxoCoin.recover(recoveryParams);

  logger.info('UTXO recovery transaction created:', recoverTx);
  if (!isFormattedOfflineVaultTxInfo(recoverTx)) {
    throw new MethodNotImplementedError(`Unknown transaction ${JSON.stringify(recoverTx)} created`);
  }

  return (await advancedWalletManagerClient.recoveryMultisig({
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
  checkRecoveryMode(req.config as MasterExpressConfig);

  const bitgo = req.bitgo;
  const coin = req.decoded.coin;
  const advancedWalletManagerClient = req.advancedWalletManagerClient;
  const { recoveryDestinationAddress, coinSpecificParams } = req.decoded;

  const sdkCoin = await coinFactory.getCoin(coin, bitgo);
  // Validate that we have correct parameters for recovery
  validateRecoveryParams(sdkCoin, coinSpecificParams, req.decoded.isTssRecovery);

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
        advancedWalletManagerClient,
        {
          userPub: commonKeychain,
          backupPub: commonKeychain,
          apiKey: '',
          walletContractAddress: '',
          unsignedSweepPrebuildTx: undefined,
          coinSpecificParams: coinSpecificParams?.solanaRecoveryOptions,
        },
      );
    } else if (isEcdsaCoin(sdkCoin)) {
      const params: recoverEcdsaMpcV2Params = {
        commonKeychain,
      };

      if (isEthLikeCoin(sdkCoin)) {
        const { maxFeePerGas, maxPriorityFeePerGas, gasLimit } = DEFAULT_MUSIG_ETH_GAS_PARAMS;
        params.ethLikeParams = {
          userKey: commonKeychain,
          backupKey: commonKeychain,
          recoveryDestination: recoveryDestinationAddress,
          walletPassphrase: '',
          isTss: true,
          walletContractAddress: coinSpecificParams?.ecdsaEthLikeRecoverySpecificParams
            ?.walletContractAddress as string,
          eip1559: { maxFeePerGas, maxPriorityFeePerGas },
          replayProtectionOptions: getReplayProtectionOptions(bitgo.env as EnvironmentName),
          gasLimit,
          bitgoDestinationAddress: coinSpecificParams?.ecdsaEthLikeRecoverySpecificParams
            ?.bitgoDestinationAddress as string,
          apiKey: coinSpecificParams?.ecdsaEthLikeRecoverySpecificParams?.apiKey,
        };
      } else if (isCosmosLikeCoin(sdkCoin)) {
        params.cosmosLikeParams = {
          recoveryDestination: recoveryDestinationAddress,
          rootAddress: coinSpecificParams?.ecdsaCosmosLikeRecoverySpecificParams?.rootAddress,
        };
      } else {
        throw new NotImplementedError(`TSS recovery is not supported for coin: ${coin}.`);
      }

      return recoverEcdsaMPCv2Wallets(bitgo, sdkCoin, advancedWalletManagerClient, params);
    } else {
      throw new ValidationError(
        `TSS recovery is not supported for coin ${coin}. ${coin} is neither eddsa nor ecdsa.`,
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
      advancedWalletManagerClient,
      {
        userPub,
        backupPub,
        apiKey,
        unsignedSweepPrebuildTx: undefined,
        coinSpecificParams: coinSpecificParams?.evmRecoveryOptions,
        walletContractAddress,
      },
      bitgo.env as EnvironmentName,
    );
  }
  if (!bitgoPub) {
    throw new Error('BitGo public key is required for recovery');
  }

  if (isUtxoCoin(sdkCoin)) {
    return handleUtxoLikeRecovery(sdkCoin, req.advancedWalletManagerClient, {
      userKey: userPub,
      backupKey: backupPub,
      bitgoKey: bitgoPub,
      ignoreAddressTypes:
        (coinSpecificParams?.utxoRecoveryOptions?.ignoreAddressTypes as ScriptType2Of3[]) ?? [],
      scan: coinSpecificParams?.utxoRecoveryOptions?.scan,
      feeRate: coinSpecificParams?.utxoRecoveryOptions?.feeRate,
      recoveryDestination: recoveryDestinationAddress,
      apiKey,
    });
  }

  throw new MethodNotImplementedError('Recovery wallet is not supported for this coin: ' + coin);
}
