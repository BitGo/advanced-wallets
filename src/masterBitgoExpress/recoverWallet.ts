import {
  AbstractEthLikeNewCoins,
  RecoverOptions,
  SignTransactionOptions,
} from '@bitgo/abstract-eth';
import { BitGoRequest } from '../types/request';
import { HalfSignedTransaction, MethodNotImplementedError } from '@bitgo/sdk-core';
import {
  OfflineVaultTxInfo,
  RecoveryInfo,
} from '@bitgo/abstract-eth/dist/src/abstractEthLikeNewCoins';

export async function handleWalletRecovery(req: BitGoRequest) {
  const bitgo = req.bitgo;

  const coin = req.params.coin;
  const baseCoin = bitgo.coin(coin);

  if (baseCoin.isEVM()) {
    const ethCoin = baseCoin as unknown as AbstractEthLikeNewCoins;

    console.log(req.body);
    try {
      // Our typing is terrible
      const recoverTx = (await ethCoin.recover({
        userKey: req.body.userKey,
        backupKey: req.body.backupKey,
        walletContractAddress: req.body.rootAddress,
        recoveryDestination: req.body.recoveryDestination,
        apiKey: req.body.apiKey,
      } as RecoverOptions)) as any;
      const passphrase = 'ZQ8MhxT84m4P';
      const userEncryptedPrv =
        '{"iv":"QDUlYaSfB5rz0nTTiyD4PQ==","v":1,"iter":10000,"ks":256,"ts":64,"mode":"ccm","adata":"","cipher":"aes","salt":"OqL2sbXqivI=","ct":"ITYwaBG/OVhqVghPfj9KxxPzjeEhZnKJviFnCXaeue99/n9hrDaURPwx3/tYXKs+UV+Hqenkh3SfU37ap5ryGsUS7XTTrUIM9gatQ5kO3HnN5apkadCqJxIRIFqh2IT2an0o1y2TIaUIApJvcFvcAYeugNnJVFs="}';
      const backupEncryptedPrv =
        '{"iv":"SiKlJGeOH6tjGMRwejOlJA==","v":1,"iter":10000,"ks":256,"ts":64,"mode":"ccm","adata":"","cipher":"aes","salt":"OqL2sbXqivI=","ct":"5VzvufOOAZ+9Rlx0q+uvbWgkzPLZpwH/qmYRM2bvribuiNdcRLEbz4iT4t0c4bTS8Ctq7gvNOq4dG3UTIopxsoElSiME5n/X83W4WHAncu+Pm8IVb9SvvoStuw2KWb1X2JbNS1hTLZP/XbCrnOI4rWM5bg31IKk="}';

      console.log(recoverTx);
      const halfSignedTx = (await ethCoin.signTransaction({
        txPrebuild: {
          ...recoverTx,
          gasPrice: String(recoverTx.gasPrice),
          gasLimit: String(recoverTx.gasLimit),
        },
        prv: bitgo.decrypt({ password: passphrase, input: userEncryptedPrv }),
        ...recoverTx,
      })) as HalfSignedTransaction;

      console.log(halfSignedTx);

      const fullSignTxParams = {
        txPrebuild: {
          ...halfSignedTx.halfSigned,
          halfSigned: halfSignedTx.halfSigned,
          txHex: (halfSignedTx.halfSigned as any).signatures,
        },
        ...halfSignedTx.halfSigned,
        signingKeyNonce: (halfSignedTx.halfSigned as any).backupKeyNonce,
        walletContractAddress: req.body.rootAddress,
        prv: bitgo.decrypt({ password: passphrase, input: backupEncryptedPrv }),
        isLastSignature: true,
      } as unknown as SignTransactionOptions;
      console.log(fullSignTxParams);
      const fullSignedTx = await ethCoin.signTransaction(fullSignTxParams);

      console.log(fullSignedTx);
    } catch (error) {
      console.log(error);
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
