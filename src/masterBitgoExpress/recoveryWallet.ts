// export async function handleRecoveryWalletOnPrem(
//   req: MasterApiSpecRouteRequest<'v1.wallet.recovery', 'post'>,
// ) {
//   console.log(req);
// }

import { AbstractEthLikeNewCoins, RecoverOptions } from '@bitgo/abstract-eth';
import { BitGoRequest } from '../types/request';
import { createEnclavedExpressClient } from './enclavedExpressClient';

export async function handleRecoveryWalletOnPrem(req: BitGoRequest) {
  const bitgo = req.bitgo;
  const coin = req.params.coin;
  // const { rootAddress, recoveryDestinationAddress, userPubKey, backupPubKey, coinSpecificParams } =
  //   req.body;

  //TODO: delete this part
  const userPubKey = '';
  const backupPubKey = '';
  const apiKey = '';
  const walletContractAddress = '';
  const recoveryDestinationAddress = '';

  const baseCoin = bitgo.coin(coin);

  const enclavedExpressClient = createEnclavedExpressClient(req.config, coin);
  if (!enclavedExpressClient) {
    throw new Error(
      'Enclaved express client not configured - enclaved express features will be disabled',
    );
  }

  // what's this? isEVM
  if (baseCoin.isEVM()) {
    let sdkCoin;
    //TODO: do we need this cast to call recover?
    if (true) {
      sdkCoin = baseCoin as unknown as AbstractEthLikeNewCoins;
      // } else if (isStxCoin(baseCoin)) {
      //   //TODO: what's the abstract coin class for stx, eos, btc, etc?
      //   sdkCoin = baseCoin as unknown as AbstractStxCoin;
    } else {
      throw new Error('Unsupported coin type for recovery: ' + coin);
    }

    // Is the other class for xtz, eos, btc ==> AbstractUtxoCoin or do we have more specialization than that?

    try {
      // const { apiKey, walletContractAddress } = coinSpecificParams;

      // recover also ask for gasPrice, gasLimit, replayProtectionOptions, etc
      // should we bring those from the coinSpecificParams or just let them empty?
      const unsignedTx = await sdkCoin.recover({
        userKey: userPubKey,
        backupKey: backupPubKey,
        walletContractAddress,
        recoveryDestination: recoveryDestinationAddress,
        apiKey,
        walletPassphrase: '^.u0UWaTI;cIx!xi9Ya1',
      } as any as RecoverOptions);
      console.log('unsigned tx payload');
      console.log(JSON.stringify(unsignedTx));
    } catch (err) {
      console.log(err);
    }
  }
}
