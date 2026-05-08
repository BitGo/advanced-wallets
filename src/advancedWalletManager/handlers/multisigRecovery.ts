import { SignFinalOptions } from '@bitgo-beta/abstract-eth';
import { AbstractUtxoCoin } from '@bitgo-beta/abstract-utxo';
import {
  HalfSignedUtxoTransaction,
  MethodNotImplementedError,
  MPCType,
  TransactionRecipient,
} from '@bitgo-beta/sdk-core';
import { AwmApiSpecRouteRequest } from '../routers/advancedWalletManagerApiSpec';
import { AdvancedWalletManagerConfig, EnvironmentName } from '../../initConfig';
import logger from '../../shared/logger';
import { isEthLikeCoin, isFormattedOfflineVaultTxInfo, isUtxoCoin } from '../../shared/coinUtils';
import {
  addEthLikeRecoveryExtras,
  DEFAULT_MUSIG_ETH_GAS_PARAMS,
  getReplayProtectionOptions,
} from '../../shared/recoveryUtils';
import { SignedEthLikeRecoveryTx } from '../../types/transaction';
import {
  checkRecoveryMode,
  retrieveKeyProviderPrvKey,
  isExternalSigningEnabledForCoin,
} from './utils/utils';
import coinFactory from '../../shared/coinFactory';
import { KeyProviderClient } from '../keyProviderClient/keyProviderClient';
import { SignResponse } from '../keyProviderClient/types/sign';
import { KeySource } from '../../shared/types';

export async function recoveryMultisigTransaction(
  req: AwmApiSpecRouteRequest<'v1.multisig.recovery', 'post'>,
): Promise<any> {
  checkRecoveryMode(req.config as AdvancedWalletManagerConfig);

  const { userPub, backupPub, bitgoPub, unsignedSweepPrebuildTx, walletContractAddress, coin } =
    req.decoded;

  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(coin, bitgo);

  if (isExternalSigningEnabledForCoin(req.config, baseCoin)) {
    const keyProvider = new KeyProviderClient(req.config);
    return recoverTransactionExternally({
      keyProvider,
      userPub,
      backupPub,
      unsignedTxHex: unsignedSweepPrebuildTx.txHex,
    });
  }

  //fetch prv and check that pub are valid
  const userPrv = await retrieveKeyProviderPrvKey({
    pub: userPub,
    source: 'user',
    cfg: req.config,
  });
  const backupPrv = await retrieveKeyProviderPrvKey({
    pub: backupPub,
    source: 'backup',
    cfg: req.config,
  });

  if (!userPrv || !backupPrv) {
    const errorMsg = `Error while recovery wallet, missing prv keys for user or backup on pub keys user=${userPub}, backup=${backupPub}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // The signed transaction format depends on the coin type so we do this check as a guard
  // If you check the type of coin before and after the "if", you may see "BaseCoin" vs "AbstractEthLikeCoin"
  if (baseCoin.isEVM()) {
    // Every recovery method on every coin family varies one from another so we need to ensure with a guard.
    if (isEthLikeCoin(baseCoin)) {
      const walletKeys = unsignedSweepPrebuildTx.xpubxWithDerivationPath;
      const pubs = [walletKeys?.user?.xpub, walletKeys?.backup?.xpub, walletKeys?.bitgo?.xpub];
      const { gasPrice, gasLimit, maxFeePerGas, maxPriorityFeePerGas } =
        DEFAULT_MUSIG_ETH_GAS_PARAMS;

      try {
        checkIfNoRecipients({
          recipients: unsignedSweepPrebuildTx.recipients,
          coin: req.decoded.coin,
        });
        const halfSignedTxBase = await baseCoin.signTransaction({
          isLastSignature: false,
          prv: userPrv,
          pubs,
          keyList: walletKeys,
          recipients: unsignedSweepPrebuildTx.recipients ?? [],
          expireTime: unsignedSweepPrebuildTx.expireTime,
          signingKeyNonce: unsignedSweepPrebuildTx.signingKeyNonce,
          gasPrice,
          gasLimit,
          eip1559: {
            maxFeePerGas,
            maxPriorityFeePerGas,
          },
          replayProtectionOptions: getReplayProtectionOptions(
            bitgo.env as EnvironmentName,
            unsignedSweepPrebuildTx.replayProtectionOptions,
          ),
          txPrebuild: {
            ...unsignedSweepPrebuildTx,
            gasPrice,
            gasLimit,
            eip1559: {
              maxFeePerGas,
              maxPriorityFeePerGas,
            },
            replayProtectionOptions: getReplayProtectionOptions(
              bitgo.env as EnvironmentName,
              unsignedSweepPrebuildTx.replayProtectionOptions,
            ),
          },
          walletContractAddress,
        });

        const halfSignedTx = addEthLikeRecoveryExtras({
          env: bitgo.env as EnvironmentName,
          signedTx: halfSignedTxBase as SignedEthLikeRecoveryTx,
          transaction: unsignedSweepPrebuildTx,
          isLastSignature: false,
          replayProtectionOptions: unsignedSweepPrebuildTx.replayProtectionOptions,
        });

        const { halfSigned } = halfSignedTx;
        const fullSignedTx = await baseCoin.signTransaction({
          isLastSignature: true,
          prv: backupPrv,
          pubs,
          keyList: walletKeys,
          recipients: halfSignedTx.recipients ?? [],
          expireTime: halfSigned?.expireTime,
          signingKeyNonce: halfSigned?.backupKeyNonce,
          gasPrice,
          gasLimit,
          txPrebuild: {
            ...halfSignedTx,
            txHex: halfSigned?.txHex,
            halfSigned,
            recipients: halfSigned?.recipients ?? [],
            gasPrice,
            gasLimit,
            eip1559: {
              maxFeePerGas,
              maxPriorityFeePerGas,
            },
            replayProtectionOptions: getReplayProtectionOptions(
              bitgo.env as EnvironmentName,
              halfSignedTx?.replayProtectionOptions,
            ),
          } as unknown as SignFinalOptions,
          walletContractAddress,
          backupKeyNonce: halfSigned?.backupKeyNonce ?? 0,
        });

        return fullSignedTx;
      } catch (error) {
        logger.error('error while recovering wallet transaction:', error);
        throw error;
      }
    } else {
      const errorMsg = 'Unsupported coin type for recovery: ' + req.decoded.coin;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  } else if (isUtxoCoin(baseCoin)) {
    const utxoCoin = baseCoin as unknown as AbstractUtxoCoin;
    if (!isFormattedOfflineVaultTxInfo(unsignedSweepPrebuildTx)) {
      throw new MethodNotImplementedError('Unknown recovery transaction format');
    } else if (!bitgoPub) {
      throw new Error('Unable to recover without bitgo public key');
    }
    try {
      const halfSigned = (await utxoCoin.signTransaction({
        isLastSignature: false,
        txPrebuild: {
          txHex: unsignedSweepPrebuildTx.txHex,
          txInfo: unsignedSweepPrebuildTx.txInfo,
        },
        allowNonSegwitSigningWithoutPrevTx: true,
        pubs: [userPub, backupPub, bitgoPub],
        prv: userPrv,
      })) as HalfSignedUtxoTransaction;
      return await utxoCoin.signTransaction({
        isLastSignature: true,
        txPrebuild: {
          txHex: halfSigned.txHex,
          txInfo: unsignedSweepPrebuildTx.txInfo,
        },
        pubs: [userPub, backupPub, bitgoPub],
        prv: backupPrv,
      });
    } catch (e) {
      throw new Error('Something went wrong signing transaction');
    }
  } else {
    throw new MethodNotImplementedError('Unsupported coin type for recovery: ' + baseCoin);
  }
}

async function recoverTransactionExternally({
  keyProvider,
  userPub,
  backupPub,
  unsignedTxHex,
}: {
  keyProvider: KeyProviderClient;
  userPub: string;
  backupPub: string;
  unsignedTxHex: string;
}): Promise<{ txHex: string }> {
  const errorResponse = (error: any, keySource: string) => ({
    status: error.status || 500,
    message: error.message || `Failed to sign recovery transaction for source=${keySource}`,
  });

  /** User Key Signs */
  let halfSignedRes: SignResponse;
  try {
    halfSignedRes = await keyProvider.sign({
      pub: userPub,
      source: KeySource.USER,
      signablePayload: unsignedTxHex,
      algorithm: MPCType.ECDSA,
    });
  } catch (error: any) {
    throw errorResponse(error, KeySource.USER);
  }

  /** Backup Key Signs */
  try {
    const fullSignedRes = await keyProvider.sign({
      pub: backupPub,
      source: KeySource.BACKUP,
      signablePayload: halfSignedRes.signature,
      algorithm: MPCType.ECDSA,
    });
    return { txHex: fullSignedRes.signature };
  } catch (error: any) {
    throw errorResponse(error, KeySource.BACKUP);
  }
}

function checkIfNoRecipients({
  recipients,
  coin,
}: {
  recipients?: TransactionRecipient[];
  coin: string;
}) {
  if (!recipients || recipients.length === 0) {
    const errorMsg = `Recovery tx for coin ${coin} must have at least one recipient.`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}
