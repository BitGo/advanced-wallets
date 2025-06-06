import {
  AbstractEthLikeNewCoins,
  OfflineVaultTxInfo,
  RecoverOptions,
  RecoveryInfo,
  UnsignedSweepTxMPCv2,
} from '@bitgo/abstract-eth';
import { MethodNotImplementedError, SignedTransaction } from '@bitgo/sdk-core';
import { BitGoRequest } from '../types/request';
import { createEnclavedExpressClient } from './enclavedExpressClient';

export async function handleWalletRecovery(req: BitGoRequest) {
  const bitgo = req.bitgo;
  const coin = req.params.coin;
  const { rootAddress, recoveryDestinationAddress, userPubKey, backupPubKey, coinSpecificParams } =
    req.body;

  const baseCoin = bitgo.coin(coin);

  const enclavedExpressClient = createEnclavedExpressClient(req.config, coin);
  if (!enclavedExpressClient) {
    throw new Error(
      'Enclaved express client not configured - enclaved express features will be disabled',
    );
  }

  if (baseCoin.isEVM()) {
    const sdkCoin = baseCoin as unknown as AbstractEthLikeNewCoins;
    try {
      const { apiKey, walletContractAddress } = coinSpecificParams;
      const unsignedTx = await sdkCoin.recover({
        userKey: userPubKey,
        backupKey: backupPubKey,
        walletContractAddress,
        recoveryDestination: recoveryDestinationAddress,
        apiKey,
      } as any as RecoverOptions);

      const txPrebuildUnsigned = prebuildPayloadFromUnsigned(unsignedTx);

      const halfSignedTx = await enclavedExpressClient.signTransaction({
        coin,
        source: 'user',
        pub: userPubKey,
        txPrebuild: txPrebuildUnsigned,
        txData: unsignedTx,
      });

      const txPrebuildHalfSigned = prebuildPayloadFromHalfSigned(halfSignedTx);

      //TODO: I managed to get this done but not enough time for checking if
      // something is extra like the halfSigned, gonna try to do that asap
      const fullSignedTx = await enclavedExpressClient.signTransaction({
        coin,
        source: 'backup',
        pub: backupPubKey,
        txPrebuild: txPrebuildHalfSigned,
        halfSigned: halfSignedTx.halfSigned,
        signingKeyNonce: (halfSignedTx.halfSigned as any).backupKeyNonce,
        walletContractAddress: rootAddress,
        isLastSignature: true,
      });

      return fullSignedTx;
    } catch (error) {
      console.log(error);
      throw new Error(`Failed to recover`);
    }
  } else {
    throw new MethodNotImplementedError();
    // const utxoCoin = baseCoin as unknown as AbstractUtxoCoin;
    //
    // const recoverTx = utxoCoin.recover({
    //   scan: req.params.scan,
    //   userKey: req.params.userKey,
    //   backupKey: req.params.backupKey,
    //   bitgoKey: req.params.bitgoKey,
    //   recoveryDestination: req.params.recoveryDestination,
    //   ignoreAddressTypes: ['p2shP2wsh'],
    //   apiKey: req.params.apiKey,
    // });
    //
    // console.log(recoverTx);
  }

  // params required for recovery
  // destination
  // userPubKey
  // backupPubKey
  // addressScanningFactor
  // apiKey
}

function prebuildPayloadFromUnsigned(
  unsignedTx: RecoveryInfo | OfflineVaultTxInfo | UnsignedSweepTxMPCv2,
) {
  if (!('gasPrice' in unsignedTx) || !('gasLimit' in unsignedTx)) {
    throw new Error('Unsigned transaction does not contain gasPrice or gasLimit');
  }
  return {
    ...unsignedTx,
    gasPrice: String(unsignedTx.gasPrice),
    gasLimit: String(unsignedTx.gasLimit),
  };
}

function prebuildPayloadFromHalfSigned(halfSignedTx: SignedTransaction) {
  return {
    ...halfSignedTx,
    halfSigned: halfSignedTx,
    txHex: (halfSignedTx.halfSigned as any).signatures,
  };
}
