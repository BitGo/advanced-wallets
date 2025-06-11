// TODO: type the handler with something like this
// export async function handleRecoveryWalletOnPrem(
//   req: MasterApiSpecRouteRequest<'v1.wallet.recovery', 'post'>,
// ) {
// }

import { SignFinalOptions } from '@bitgo/abstract-eth';
import { isEosCoin, isEthCoin, isStxCoin, isUtxoCoin, isXtzCoin } from '../shared/coinUtils';
import { BitGoRequest } from '../types/request';
import { createEnclavedExpressClient } from './enclavedExpressClient';

// TODO: this is gonna be present on eve so we can remove this
const userEncryptedPrv = '';
const backupEncryptedPrv = '';
const passphrase = '';
// TODO: ---end remove vars

export async function handleRecoveryWalletOnPrem(req: BitGoRequest) {
  const bitgo = req.bitgo;
  const coin = req.params.coin;

  const {
    userPub,
    backupPub,
    walletContractAddress,
    recoveryDestinationAddress,
    coinSpecificParams,
  } = req.body;

  const baseCoin = bitgo.coin(coin);
  const enclavedExpressClient = createEnclavedExpressClient(req.config, coin);
  if (!enclavedExpressClient) {
    throw new Error(
      'Enclaved express client not configured - enclaved express features will be disabled',
    );
  }

  const sdkCoin = baseCoin;
  const commonRecoverParams = {
    userKey: userPub,
    backupKey: backupPub,
    walletContractAddress,
    recoveryDestination: recoveryDestinationAddress,
    // TODO: add api key here, currently configured on bitgo obj
    // apiKey,
  };
  if (baseCoin.isEVM()) {
    if (isEthCoin(sdkCoin)) {
      try {
        // TODO: populate coinSpecificParams with things like replayProtectionOptions
        // coinSpecificParams type could be "recoverOptions"
        const unsignedTx = await sdkCoin.recover({
          ...commonRecoverParams,
          walletPassphrase: passphrase,
        });

        const halfSignedTx = await sdkCoin.signTransaction({
          txPrebuild: { ...unsignedTx } as unknown as SignFinalOptions,
          prv: bitgo.decrypt({ password: passphrase, input: userEncryptedPrv }),
        });

        const { halfSigned } = halfSignedTx as any;
        const fullSignedTx = await sdkCoin.signTransaction({
          isLastSignature: true,
          signingKeyNonce: halfSigned.signingKeyNonce ?? 0,
          backupKeyNonce: halfSigned.backupKeyNonce ?? 0,
          txPrebuild: {
            ...halfSigned,
            txHex: halfSigned.signatures,
            halfSigned,
          } as unknown as SignFinalOptions,
          prv: bitgo.decrypt({ password: passphrase, input: backupEncryptedPrv }),
          recipients: halfSigned.recipients ?? [],
          walletContractAddress: walletContractAddress,
        });
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else {
      throw new Error('Unsupported coin type for recovery: ' + coin);
    }
  } else {
    // TODO (can't advance): XTZ throws a method not implemented on recover.
    if (isXtzCoin(sdkCoin)) {
      try {
        const unsignedTx = await sdkCoin.recover({
          ...commonRecoverParams,
        });

        //TODO: fill this fields, check output from recover when recover implemented on sdk for xtz
        const txHex = '';
        const txInfo = 'txInfo' in unsignedTx ? unsignedTx.txInfo : undefined;
        const addressInfo = 'addressInfo' in unsignedTx ? unsignedTx.addressInfo : undefined;
        const feeInfo = 'feeInfo' in unsignedTx ? unsignedTx.feeInfo : undefined;
        const source = '';
        const dataToSign = '';

        const halfSignedTx = await sdkCoin.signTransaction({
          txPrebuild: {
            txHex,
            txInfo,
            addressInfo,
            feeInfo,
            source,
            dataToSign,
          },
          prv: bitgo.decrypt({ password: passphrase, input: userEncryptedPrv }),
        });
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else if (isStxCoin(sdkCoin)) {
      //TODO: (implementation untested): prioritize eth and btc instead of stc, when the other couple finished, go back to STX
      try {
        const unsignedTx = await sdkCoin.recover({
          ...commonRecoverParams,
          rootAddress: walletContractAddress, // TODO: is a root address the same as wallet contract address? where does root address comes from if not?
        });
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else if (isEosCoin(sdkCoin)) {
      // TODO (implementation untested): we need some funds but faucets not working
      try {
        const unsignedTx = await sdkCoin.recover({
          ...commonRecoverParams,
        });
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else if (isUtxoCoin(sdkCoin)) {
      //TODO (implementation untested): we need an API key to complete/test btc flow
      //TODO: do we need a special case for BTC or is another UTXO-based coin?

      const { bitgoPub } = coinSpecificParams || '';
      try {
        const unsignedTx = await sdkCoin.recover({
          ...commonRecoverParams,
          bitgoKey: bitgoPub,
          ignoreAddressTypes: coinSpecificParams?.ignoreAddressTypes || [],
        });

        // some guards as the types have some imcompatibilities issues
        const txInfo = 'txInfo' in unsignedTx ? unsignedTx.txInfo : undefined;
        const txHex = 'txHex' in unsignedTx ? unsignedTx.txHex : '';

        const halfSignedTx = await sdkCoin.signTransaction({
          txPrebuild: {
            txHex,
            txInfo,
          },
          prv: bitgo.decrypt({ password: passphrase, input: userEncryptedPrv }),
        });

        const fullSignedTx = await sdkCoin.signTransaction({
          //TODO: check the body of this based on halfSignedTx output
          isLastSignature: true,
          txPrebuild: {
            txHex,
            txInfo,
          },
          signingStep: 'cosignerNonce',
        });
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else {
      throw new Error('Unsupported coin type for recovery: ' + coin);
    }
  }
}
