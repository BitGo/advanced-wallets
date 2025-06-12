import { SignFinalOptions } from '@bitgo/abstract-eth';
import { MethodNotImplementedError } from 'bitgo';
import { EnclavedApiSpecRouteRequest } from '../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { KmsClient } from '../../kms/kmsClient';
import logger from '../../logger';
import { isEosCoin, isEthCoin, isStxCoin, isUtxoCoin, isXtzCoin } from '../../shared/coinUtils';

export async function recoveryMultisigTransaction(
  req: EnclavedApiSpecRouteRequest<'v1.multisig.recovery', 'post'>,
): Promise<any> {
  const {
    userPub,
    backupPub,
    walletContractAddress,
    recoveryDestinationAddress,
    recoveryParams,
    apiKey,
  } = req.body;

  //fetch prv and check that pub are valid
  const userPrv = await retrieveKmsKey({ pub: userPub, source: 'user' });
  const backupPrv = await retrieveKmsKey({ pub: backupPub, source: 'user' });

  if (!userPrv || !backupPrv) {
    const errorMsg = `Error while recovery wallet, missing prv keys for user or backup on pub keys user=${userPub}, backup=${backupPub}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  const bitgo = req.bitgo;
  const coin = bitgo.coin(req.params.coin);

  //construct a common payload for the recovery that it's repeated in any kind of recovery
  const commonRecoveryParams = {
    userKey: userPub,
    backupKey: backupPub,
    walletContractAddress,
    recoveryDestination: recoveryDestinationAddress,
    // TODO: api key is not used so far because of a missconfig error on the bitgo obj
    apiKey,
  };

  // The signed transaction format depends on the coin type so we do this check as a guard
  // If you check the type of coin before and after the "if", you may see "BaseCoin" vs "AbstractEthLikeCoin"
  if (coin.isEVM()) {
    // Every recovery method on every coin family varies one from another so we need to ensure with a guard.
    if (isEthCoin(coin)) {
      // TODO: populate coinSpecificParams with things like replayProtectionOptions
      // coinSpecificParams type could be "recoverOptions"
      try {
        const unsignedTx = await coin.recover({
          ...commonRecoveryParams,
          //TODO: it's needed for keycard debugging, the walletPassphrase
          //walletPassphrase: passphrase,
        });

        const halfSignedTx = await coin.signTransaction({
          isLastSignature: false,
          prv: userPrv,
          txPrebuild: { ...unsignedTx } as unknown as SignFinalOptions,
        });

        const { halfSigned } = halfSignedTx as any;
        const fullSignedTx = await coin.signTransaction({
          isLastSignature: true,
          prv: backupPrv,
          txPrebuild: {
            ...halfSignedTx,
            txHex: halfSigned.signatures,
            halfSigned,
          },
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
      const errorMsg = 'Unsupported coin type for recovery: ' + req.params.coin;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  } else {
    // TODO: from now on, this part isn't tested as we're lacking funds/apiKeys/etc
    // TODO: WIP
    // TODO (can't advance): XTZ throws a method not implemented on recover.
    if (isXtzCoin(coin)) {
      try {
        const unsignedTx = await coin.recover({
          ...commonRecoveryParams,
        });

        //TODO: fill this fields, check output from recover when recover implemented on sdk for xtz
        const txHex = '';
        const txInfo = 'txInfo' in unsignedTx ? unsignedTx.txInfo : undefined;
        const addressInfo = 'addressInfo' in unsignedTx ? unsignedTx.addressInfo : undefined;
        const feeInfo = 'feeInfo' in unsignedTx ? unsignedTx.feeInfo : undefined;
        const source = '';
        const dataToSign = '';

        const halfSignedTx = await coin.signTransaction({
          txPrebuild: {
            txHex,
            txInfo,
            addressInfo,
            feeInfo,
            source,
            dataToSign,
          },
          prv: userPrv,
        });
        //TODO: continue with full sign and return that
        //      still needs to be tested in order to deduce min payload
        return halfSignedTx;
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else if (isStxCoin(coin)) {
      //TODO: (implementation untested): prioritize eth and btc instead of stc, when the other couple finished, go back to STX
      try {
        const unsignedTx = await coin.recover({
          ...commonRecoveryParams,
          rootAddress: walletContractAddress, // TODO: is a root address the same as wallet contract address? where does root address comes from if not?
        });
        //TODO: continue with half sign and return that
        return unsignedTx;
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else if (isEosCoin(coin)) {
      // TODO (implementation untested): we need some funds but faucets not working
      try {
        const unsignedTx = await coin.recover({
          ...commonRecoveryParams,
        });

        //TODO: continue with half sign and return that
        return unsignedTx;
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else if (isUtxoCoin(coin)) {
      //TODO (implementation untested): we need an API key to complete/test btc flow
      //TODO: do we need a special case for BTC or is another UTXO-based coin?

      const { bitgoPub } = recoveryParams;
      if (!bitgoPub) {
        logger.error('Missing bitgoPub in recoveryParams for UTXO coin recovery');
        throw new Error('Missing bitgoPub in recoveryParams for UTXO coin recovery');
      }
      try {
        const unsignedTx = await coin.recover({
          ...commonRecoveryParams,
          bitgoKey: bitgoPub,
          ignoreAddressTypes: recoveryParams.ignoreAddressTypes || [],
        });

        // some guards as the types have some imcompatibilities issues
        const txInfo = 'txInfo' in unsignedTx ? unsignedTx.txInfo : undefined;
        const txHex = 'txHex' in unsignedTx ? unsignedTx.txHex : '';

        const halfSignedTx = await coin.signTransaction({
          txPrebuild: {
            txHex,
            txInfo,
          },
          prv: userPrv,
        });

        const fullSignedTx = await coin.signTransaction({
          //TODO: check the body of this based on halfSignedTx output
          isLastSignature: true,
          txPrebuild: {
            txHex,
            txInfo,
          },
          signingStep: 'cosignerNonce',
        });

        console.log(halfSignedTx);
        throw new MethodNotImplementedError(
          'Full signing for UTXO coins is not implemented in recovery yet. Please implement it.',
        );

        return fullSignedTx;
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else {
      throw new Error('Unsupported coin type for recovery: ' + coin);
    }
  }
}

// TODO: this function is duplicated in multisigTransactioSign.ts but as hardcoded.
//       move both to an utils file
async function retrieveKmsKey({ pub, source }: { pub: string; source: string }): Promise<string> {
  const kms = new KmsClient();
  // Retrieve the private key from KMS
  let prv: string;
  try {
    const res = await kms.getKey({ pub, source });
    prv = res.prv;
    return prv;
  } catch (error: any) {
    throw {
      status: error.status || 500,
      message: error.message || 'Failed to retrieve key from KMS',
    };
  }
}
