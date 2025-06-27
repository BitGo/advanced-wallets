import { SignFinalOptions } from '@bitgo/abstract-eth';
import { HalfSignedUtxoTransaction, MethodNotImplementedError } from 'bitgo';
import { EnclavedApiSpecRouteRequest } from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import logger from '../../../logger';
import {
  isEthLikeCoin,
  isFormattedOfflineVaultTxInfo,
  isUtxoCoin,
} from '../../../shared/coinUtils';
import {
  addEthLikeRecoveryExtras,
  getDefaultMusigEthGasParams,
  getReplayProtectionOptions,
} from '../../../shared/recoveryUtils';
import { SignedEthLikeRecoveryTx } from '../../../types/transaction';
import { retrieveKmsPrvKey } from '../utils';
import { AbstractUtxoCoin } from '@bitgo/abstract-utxo';

export async function recoveryMultisigTransaction(
  req: EnclavedApiSpecRouteRequest<'v1.multisig.recovery', 'post'>,
): Promise<any> {
  const { userPub, backupPub, bitgoPub, unsignedSweepPrebuildTx, walletContractAddress, coin } =
    req.decoded;

  //fetch prv and check that pub are valid
  const userPrv = await retrieveKmsPrvKey({ pub: userPub, source: 'user', cfg: req.config });
  const backupPrv = await retrieveKmsPrvKey({ pub: backupPub, source: 'backup', cfg: req.config });

  if (!userPrv || !backupPrv) {
    const errorMsg = `Error while recovery wallet, missing prv keys for user or backup on pub keys user=${userPub}, backup=${backupPub}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(coin);

  // The signed transaction format depends on the coin type so we do this check as a guard
  // If you check the type of coin before and after the "if", you may see "BaseCoin" vs "AbstractEthLikeCoin"
  if (baseCoin.isEVM()) {
    // Every recovery method on every coin family varies one from another so we need to ensure with a guard.
    if (isEthLikeCoin(baseCoin)) {
      const walletKeys = unsignedSweepPrebuildTx.xpubxWithDerivationPath;
      const pubs = [walletKeys?.user?.xpub, walletKeys?.backup?.xpub, walletKeys?.bitgo?.xpub];
      const { gasPrice, gasLimit, maxFeePerGas, maxPriorityFeePerGas } =
        getDefaultMusigEthGasParams();

      try {
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
              unsignedSweepPrebuildTx.replayProtectionOptions,
            ),
          },
          walletContractAddress,
        });

        const halfSignedTx = addEthLikeRecoveryExtras({
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
