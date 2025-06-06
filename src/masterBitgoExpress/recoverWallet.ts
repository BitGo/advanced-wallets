import { AbstractEthLikeNewCoins } from '@bitgo/abstract-eth';
import { MethodNotImplementedError } from '@bitgo/sdk-core';
import { BitGoRequest } from '../types/request';
import { createEnclavedExpressClient } from './enclavedExpressClient';
import { parseRecoveryWalletParams } from './recoveryUtils';

export async function handleWalletRecovery(req: BitGoRequest) {
  const bitgo = req.bitgo;

  const coin = req.params.coin;
  const baseCoin = bitgo.coin(coin);
  const rootAddress = req.body.rootAddress;

  const enclavedExpressClient = createEnclavedExpressClient(req.config, coin);
  // TODO: move this error check to a func, it's repeated in other places
  if (!enclavedExpressClient) {
    throw new Error(
      'Enclaved express client not configured - enclaved express features will be disabled',
    );
  }

  if (baseCoin.isEVM()) {
    const ethCoin = baseCoin as unknown as AbstractEthLikeNewCoins;
    try {
      const bodyParams = parseRecoveryWalletParams(req);
      const recoverTx = await ethCoin.recover(bodyParams);

      const halfSignedTx = await enclavedExpressClient.signTransactionWIP({
        intent: 'recover-half-sign',
        coin,
        parameters: { ...recoverTx, key: bodyParams.userKey },
      });
      const fullSignedTx = await enclavedExpressClient.signTransactionWIP({
        intent: 'recover-full-sign',
        coin,
        parameters: { ...halfSignedTx, rootAddress, key: bodyParams.backupKey },
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
