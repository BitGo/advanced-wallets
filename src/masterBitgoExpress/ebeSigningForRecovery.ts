import { AbstractEthLikeNewCoins, SignTransactionOptions } from '@bitgo/abstract-eth';
import { HalfSignedTransaction } from '@bitgo/sdk-core';

async function signRecovery(req: Request) {
  //TODO: @alex move this block inside EBE on your sign method, remove the function signRecovery part
  // TODO: pub is used for userPrv and backupPrv
  const { txPrebuild, txData, pub, source, coin } = req.body;

  if (coin.isEVM()) {
    const sdkCoin = coin as unknown as AbstractEthLikeNewCoins;

    switch (source) {
      case 'user': {
        const userPrv = ''; // TODO: fetch it from KMS, already decrypted. source="user", pub in req.body

        try {
          const halfSignedTx = (await sdkCoin.signTransaction({
            txPrebuild,
            prv: userPrv,
            ...txData,
          })) as HalfSignedTransaction;

          return halfSignedTx;
        } catch (error) {
          console.log(error);
          throw new Error(`Failed to half-sign transaction recovery`);
        }
      }
      case 'backup': {
        const backupPrv = ''; // TODO: fetch it from KMS, already decrypted. source="backup", pub in req.body
        const { halfSigned, signingKeyNonce, walletContractAddress, isLastSignature } = req.body;
        try {
          const fullSignTxParams = {
            txPrebuild,
            ...halfSigned,
            signingKeyNonce,
            walletContractAddress,
            prv: backupPrv,
            isLastSignature,
          } as unknown as SignTransactionOptions;

          const fullSignedTx = await sdkCoin.signTransaction(fullSignTxParams);
          return fullSignedTx;
        } catch (error) {
          console.log(error);
          throw new Error(`Failed to full-sign transaction`);
        }
      }
    }
  } else {
    throw new Error(`Unsupported coin type for recovery: ${coin}`);
  }
}
