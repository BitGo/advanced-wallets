import { SignFinalOptions } from '@bitgo/abstract-eth';
import { MethodNotImplementedError } from 'bitgo';
import { EnclavedApiSpecRouteRequest } from '../../enclavedBitgoExpress/routers/enclavedApiSpec';
import logger from '../../logger';
import { isEthLikeCoin } from '../../shared/coinUtils';
import { retrieveKmsKey } from './utils';

export async function recoveryMultisigTransaction(
  req: EnclavedApiSpecRouteRequest<'v1.multisig.recovery', 'post'>,
): Promise<any> {
  const { userPub, backupPub, unsignedSweepPrebuildTx, walletContractAddress } = req.body;

  //fetch prv and check that pub are valid
  const userPrv = await retrieveKmsKey({ pub: userPub, source: 'user', cfg: req.config });
  const backupPrv = await retrieveKmsKey({ pub: backupPub, source: 'backup', cfg: req.config });

  if (!userPrv || !backupPrv) {
    const errorMsg = `Error while recovery wallet, missing prv keys for user or backup on pub keys user=${userPub}, backup=${backupPub}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  const bitgo = req.bitgo;
  const coin = bitgo.coin(req.decoded.coin);

  // The signed transaction format depends on the coin type so we do this check as a guard
  // If you check the type of coin before and after the "if", you may see "BaseCoin" vs "AbstractEthLikeCoin"
  if (coin.isEVM()) {
    // Every recovery method on every coin family varies one from another so we need to ensure with a guard.
    if (isEthLikeCoin(coin)) {
      try {
        const halfSignedTx = await coin.signTransaction({
          isLastSignature: false,
          prv: userPrv,
          txPrebuild: { ...unsignedSweepPrebuildTx } as unknown as SignFinalOptions,
          walletContractAddress,
        });

        const { halfSigned } = halfSignedTx as any;
        const fullSignedTx = await coin.signTransaction({
          isLastSignature: true,
          prv: backupPrv,
          txPrebuild: {
            ...halfSignedTx,
            txHex: halfSigned.signatures,
            halfSigned,
            recipients: halfSigned.recipients ?? [],
          } as unknown as SignFinalOptions,
          walletContractAddress,
          signingKeyNonce: halfSigned.signingKeyNonce ?? 0,
          backupKeyNonce: halfSigned.backupKeyNonce ?? 0,
          recipients: halfSigned.recipients ?? [],
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
  } else {
    throw new MethodNotImplementedError('Unsupported coin type for recovery: ' + coin);
  }
}
