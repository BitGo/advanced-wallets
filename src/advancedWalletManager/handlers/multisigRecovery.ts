import { AbstractUtxoCoin } from '@bitgo-beta/abstract-utxo';
import {
  BaseCoin,
  HalfSignedUtxoTransaction,
  MethodNotImplementedError,
  MPCType,
  SignedTransaction,
  TransactionRecipient,
} from '@bitgo-beta/sdk-core';
import { AwmApiSpecRouteRequest } from '../routers/advancedWalletManagerApiSpec';
import { AdvancedWalletManagerConfig, EnvironmentName } from '../../initConfig';
import logger from '../../shared/logger';
import { BadRequestError, BitgoApiResponseError } from '../../shared/errors';
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
): Promise<SignedTransaction> {
  checkRecoveryMode(req.config as AdvancedWalletManagerConfig);

  const {
    userPub,
    backupPub,
    bitgoPub,
    unsignedSweepPrebuildTx,
    walletContractAddress,
    coin,
    keyToSign,
    halfSignedTransaction,
  } = req.decoded;

  if (keyToSign === 'backup' && !halfSignedTransaction) {
    throw new BadRequestError('halfSignedTransaction is required when keyToSign is "backup"');
  }

  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(coin, bitgo);

  if (isExternalSigningEnabledForCoin(req.config, baseCoin)) {
    // External signing operates on flat txHex strings. An EVM half-signed tx is a rich object
    // (halfSigned.txHex nested), so reject backup signing with such a payload as misconfiguration
    // rather than silently passing undefined into the key provider.
    if (keyToSign === 'backup' && baseCoin.isEVM()) {
      if (
        !halfSignedTransaction ||
        typeof (halfSignedTransaction as { txHex?: unknown }).txHex !== 'string'
      ) {
        throw new BadRequestError(
          'External backup signing for EVM coins requires halfSignedTransaction.txHex (a flat half-signed tx)',
        );
      }
    }
    const keyProvider = new KeyProviderClient(req.config);
    return recoverTransactionExternally({
      keyProvider,
      userPub,
      backupPub,
      unsignedTxHex: unsignedSweepPrebuildTx.txHex,
      keyToSign,
      halfSignedTxHex: halfSignedTransaction?.txHex,
    });
  }

  // Fetch only the key(s) needed for this signing step.
  const userPrv =
    keyToSign === 'backup'
      ? undefined
      : await retrieveKeyProviderPrvKey({ pub: userPub, source: 'user', cfg: req.config });
  const backupPrv =
    keyToSign === 'user'
      ? undefined
      : await retrieveKeyProviderPrvKey({ pub: backupPub, source: 'backup', cfg: req.config });

  if (keyToSign !== 'backup' && !userPrv) {
    const errorMsg = `Error during recovery: missing user prv key for pub=${userPub}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
  if (keyToSign !== 'user' && !backupPrv) {
    const errorMsg = `Error during recovery: missing backup prv key for pub=${backupPub}`;
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
        if (keyToSign === 'backup') {
          if (!isSignedEthLikeRecoveryTx(halfSignedTransaction)) {
            throw new BadRequestError(
              'halfSignedTransaction must be an EVM half-signed recovery tx when keyToSign is "backup"',
            );
          }
          const halfSignedTx = halfSignedTransaction;
          const { halfSigned } = halfSignedTx;
          // Cast to BaseCoin for the loose SignTransactionOptions signature; the
          // AbstractEthLikeNewCoins overload's stricter txPrebuild types don't fit recovery.
          return await (baseCoin as BaseCoin).signTransaction({
            isLastSignature: true,
            prv: backupPrv!,
            pubs,
            keyList: walletKeys,
            recipients: halfSignedTx.recipients ?? [],
            expireTime: halfSigned?.expireTime,
            signingKeyNonce: halfSigned?.backupKeyNonce,
            gasPrice,
            gasLimit,
            txPrebuild: {
              ...(halfSignedTx as Record<string, unknown>),
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
            },
            walletContractAddress,
            backupKeyNonce: halfSigned?.backupKeyNonce ?? 0,
          });
        }

        checkIfNoRecipients({
          recipients: unsignedSweepPrebuildTx.recipients,
          coin: req.decoded.coin,
        });
        const halfSignedTxBase = await (baseCoin as BaseCoin).signTransaction({
          isLastSignature: false,
          prv: userPrv!,
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

        // User-only: return half-signed tx for the backup AWM to complete.
        if (keyToSign === 'user') {
          return halfSignedTx;
        }

        const { halfSigned } = halfSignedTx;
        const fullSignedTx = await (baseCoin as BaseCoin).signTransaction({
          isLastSignature: true,
          prv: backupPrv!,
          pubs,
          keyList: walletKeys,
          recipients: halfSignedTx.recipients ?? [],
          expireTime: halfSigned?.expireTime,
          signingKeyNonce: halfSigned?.backupKeyNonce,
          gasPrice,
          gasLimit,
          txPrebuild: {
            ...(halfSignedTx as Record<string, unknown>),
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
          },
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
    const utxoCoin = baseCoin as AbstractUtxoCoin;
    if (keyToSign !== 'backup' && !isFormattedOfflineVaultTxInfo(unsignedSweepPrebuildTx)) {
      throw new MethodNotImplementedError('Unknown recovery transaction format');
    }
    if (!bitgoPub) {
      throw new Error('Unable to recover without bitgo public key');
    }
    try {
      const walletPubs = [userPub, backupPub, bitgoPub] as [string, string, string];

      if (keyToSign === 'backup') {
        if (!isHalfSignedUtxoTransaction(halfSignedTransaction)) {
          throw new BadRequestError(
            'halfSignedTransaction must be a UTXO half-signed tx { txHex } when keyToSign is "backup"',
          );
        }
        if (!unsignedSweepPrebuildTx.txInfo) {
          throw new BadRequestError(
            'unsignedSweepPrebuildTx.txInfo is required for backup-only UTXO recovery',
          );
        }
        return await utxoCoin.signTransaction({
          isLastSignature: true,
          txPrebuild: {
            txHex: halfSignedTransaction.txHex,
            txInfo: unsignedSweepPrebuildTx.txInfo,
          },
          pubs: walletPubs,
          prv: backupPrv!,
        });
      }

      const halfSigned = (await utxoCoin.signTransaction({
        isLastSignature: false,
        txPrebuild: {
          txHex: unsignedSweepPrebuildTx.txHex,
          txInfo: unsignedSweepPrebuildTx.txInfo,
        },
        allowNonSegwitSigningWithoutPrevTx: true,
        pubs: walletPubs,
        prv: userPrv!,
      })) as HalfSignedUtxoTransaction;

      // User-only: return half-signed tx for the backup AWM to complete.
      if (keyToSign === 'user') {
        return halfSigned;
      }

      return await utxoCoin.signTransaction({
        isLastSignature: true,
        txPrebuild: {
          txHex: halfSigned.txHex,
          txInfo: unsignedSweepPrebuildTx.txInfo,
        },
        pubs: walletPubs,
        prv: backupPrv!,
      });
    } catch (error) {
      logger.error('error while recovering UTXO recovery transaction:', error);
      throw error;
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
  keyToSign,
  halfSignedTxHex,
}: {
  keyProvider: KeyProviderClient;
  userPub: string;
  backupPub: string;
  unsignedTxHex: string;
  keyToSign?: 'user' | 'backup';
  halfSignedTxHex?: string;
}): Promise<{ txHex: string }> {
  if (keyToSign === 'backup') {
    if (!halfSignedTxHex) {
      throw new BadRequestError('halfSignedTxHex is required for backup-only external signing');
    }
    try {
      const fullSignedRes = await keyProvider.sign({
        pub: backupPub,
        source: KeySource.BACKUP,
        signablePayload: halfSignedTxHex,
        algorithm: MPCType.ECDSA,
      });
      return { txHex: fullSignedRes.signature };
    } catch (error: unknown) {
      throw signingError(error, KeySource.BACKUP);
    }
  }

  /** User Key Signs */
  let halfSignedRes: SignResponse;
  try {
    halfSignedRes = await keyProvider.sign({
      pub: userPub,
      source: KeySource.USER,
      signablePayload: unsignedTxHex,
      algorithm: MPCType.ECDSA,
    });
  } catch (error: unknown) {
    throw signingError(error, KeySource.USER);
  }

  // User-only: return half-signed tx for the backup AWM to complete.
  if (keyToSign === 'user') {
    return { txHex: halfSignedRes.signature };
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
  } catch (error: unknown) {
    throw signingError(error, KeySource.BACKUP);
  }
}

// Wraps a key-provider signing failure so the response handler preserves upstream status/message.
function signingError(error: unknown, keySource: KeySource): BitgoApiResponseError {
  const status =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
  const message =
    error instanceof Error && error.message
      ? error.message
      : `Failed to sign recovery transaction for source=${keySource}`;
  return new BitgoApiResponseError(message, status, { keySource });
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

// Runtime narrows for the coin-specific half-signed tx shapes (halfSignedTransaction is `any`).
function isHalfSignedUtxoTransaction(value: unknown): value is HalfSignedUtxoTransaction {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HalfSignedUtxoTransaction).txHex === 'string'
  );
}

function isSignedEthLikeRecoveryTx(value: unknown): value is SignedEthLikeRecoveryTx {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const halfSigned = (value as { halfSigned?: unknown }).halfSigned;
  // The backup path reads halfSigned.txHex and optionally expireTime/backupKeyNonce/recipients,
  // so require halfSigned to be a non-null object with a string txHex.
  return (
    typeof halfSigned === 'object' &&
    halfSigned !== null &&
    typeof (halfSigned as { txHex?: unknown }).txHex === 'string'
  );
}
